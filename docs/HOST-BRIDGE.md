# Host ↔ Electron 聊天桥接协议（v1 设计稿）

状态：第七阶段设计稿，先于实现提交。实现只使用**本地模拟模型**，不发起任何真实 LLM 请求。

## 1. 为什么需要这条通道

| 进程 | 位置 | 能看到什么 |
| --- | --- | --- |
| DSH Host | `src/index.js`（DSH 进程内） | `ctx.llm`、`ctx.credentials`、`agentDefaultModel` 等服务 |
| Electron 桌宠 | `desktop/main.mjs` + `src/viewer-server.js` | 只有本机 HTTP，**没有** `ctx` |
| 渲染器页面 | `renderer/viewer.js` | 只能访问 viewer-server 的同源地址 |

因此真实模型调用必须发生在 Host，Electron 只做"带认证的本地转发"。
现有 `desktop-bridge.json` 是 **Electron → Host** 的方向（Host 读取端口与令牌，用来推送状态/余额）；
本协议新增反方向 **Host → Electron** 的通道，两者互不覆盖。

## 2. 拓扑

```
┌──────────── DSH Host 进程 ────────────┐        ┌──────── Electron 进程 ────────┐
│ src/index.js                          │        │ desktop/main.mjs              │
│  ├─ activity / bridge publisher ──────┼──POST──▶ desktop-bridge.json（既有）  │
│  └─ host-bridge server (127.0.0.1:P) ◀┼─────────┼── viewer-server.js            │
│       │ 文件 host-bridge.json         │  POST   │      │  POST /chat           │
│       ▼                               │  Bearer │      ▼                       │
│  host-adapter（模拟/未来真实 llm）     │◀────────┼── 渲染器 fetch+SSE            │
└───────────────────────────────────────┘        └───────────────────────────────┘
```

## 3. 文件与身份

### 3.1 `host-bridge.json`（新，Host 写、Electron 读）

位置：`<configDir>/host-bridge.json`，写入用临时文件 + `rename`，退出时删除。
权限语义：所在目录即 `~/.dsh/live2d`，仅当前用户可读；令牌**只**给本机 Electron。

```json
{
  "version": 1,
  "protocol": "dsh-live2d-host-bridge/1",
  "host": "127.0.0.1",
  "port": 52341,
  "token": "<48–64 字符随机十六进制>",
  "pid": 12345,
  "startedAt": 1762290000000,
  "capabilities": { "chat": ["simulated"], "backend": "simulated" }
}
```

- `token` 由 `randomBytes(32)` 生成，每次 Host 启动都换新；
- `pid` 用于 Electron 判断文件是否陈旧（进程已退出时忽略）；
- `capabilities.chat` 声明当前可用后端：本阶段固定 `["simulated"]`，接入真实模型后才可能出现 `"host-llm"`；
- 文件缺失 / 版本不匹配 / pid 不存在 → Electron 视为"Host 不在线"。

### 3.2 `desktop-bridge.json`（既有，保持兼容）

字段 `{ port, token, pid }` 与语义**不变**，继续用于 Host → Electron 的状态推送与余额刷新。
本协议不修改它的任何字段；新增能力全部走 `host-bridge.json` 与新路由。

## 4. 端点

仅监听 `127.0.0.1`；路径固定 `/chat`；必须带 `Authorization: Bearer <token>`。

```
POST http://127.0.0.1:<port>/chat
Content-Type: application/json
Authorization: Bearer <token>

{ "text": "用户输入", "mode": "pet", "backend": "simulated" }
```

响应：`200 text/event-stream; charset=utf-8`，帧格式与 viewer-server 内部聊天完全一致：

| event | data | 说明 |
| --- | --- | --- |
| `meta` | `{type:"meta",simulated:true,backend:"simulated",model:"local-simulator"}` | 首帧，声明后端与是否模拟 |
| `delta` | `{type:"delta",text:"…"}` | 文本分片 |
| `end` | `{type:"end",reason:"ok"\|"aborted",simulated:true}` | 正常结束/被取消 |
| `error` | `{type:"error",code:"timeout"\|"empty-stream"\|"upstream-error"\|"rate-limited"\|…}` | 失败 |

错误码（HTTP）：`401` 令牌缺失/错误、`403` 来源不是本机回环、`400` 文本非法、`413` 体过大、
`429` 并发占用或限流、`409` 聊天关闭。

响应头必带 `Cache-Control: no-store`、`X-Accel-Buffering: no`；每 10 秒写 `: keepalive`。

## 5. 限额（与现有对话一致，服务端强制）

| 项 | 值 | 备注 |
| --- | --- | --- |
| 请求体 | 8 KiB | 超限回 413，不写日志 |
| 单条文本 | 500 字符（按码点） | 客户端与服务端都校验 |
| 并发 | 1 | 第二条 429 `chat-busy` |
| 频率 | 6 次/分钟（滑动窗口） | 超限 429 `rate-limited` + `Retry-After` |
| 超时 | 30 秒 | 到点 abort，回 `error{timeout}` |

真实模式接上后这些限额不变；**不自动重试**收费请求。

## 6. 生命周期与清理

| 事件 | Host 侧 | Electron 侧 |
| --- | --- | --- |
| 插件启动 | 起 server、写 `host-bridge.json` | 读文件；失败不影响动画 |
| 插件卸载 / Host 退出 | `ctx.effect` 清理：关闭 server、删文件、清定时器 | 下一条请求发现连接失败 → 降级 |
| Electron 关闭 | — | 关闭本地 viewer、取消在途聊天、删 `desktop-bridge.json`（既有逻辑） |
| 请求取消 | 监听 `req/res close` → `AbortController.abort()` | 用户点停止 / 关闭面板 → abort fetch |

**降级规则**：Electron 转发失败（连接拒绝、401、超时、Host 中途退出）时，不阻塞 UI：
回一帧 `meta{backend:"simulated",degraded:true,reason}` 然后用本地仿真继续；状态行显示
"DSH 模型不可用，已降级为本地模拟"。动画、装扮、跟随、点击反馈完全不受影响。

## 7. 安全边界

- 只绑定 `127.0.0.1`，不监听 `0.0.0.0`；
- 令牌不写日志、不出现在渲染器可读的任何 URL/响应里（只走 Header）；
- 渲染器永远拿不到真实 API Key 或 Host 令牌：Electron 内部持有，转发时使用；
- 请求正文不落盘、不写日志、不进 telemetry；日志只记录长度、分片数、错误码；
- Host 侧不信任 Electron 传来的任何字段：文本重新校验，模式白名单，后端由 Host 决定；
- 跨域：Host 校验 `Origin` 缺失或为 `http://127.0.0.1:<port>`；Electron 侧对渲染器仍用同源 + token 路径。

## 8. 宿主适配器契约（本轮只实现模拟）

```text
resolveHostModel({ llm, agentDefaultModel }) -> { provider, model } | null
  1. agentDefaultModel 的解析结果（不写死 deepseek-flash）
  2. llm.listProviders() + listModels() 的第一个可用组合
  3. 都没有 -> null（降级模拟，不报错）

streamHostChat({ llm, provider, model, messages, signal })
  -> AsyncIterable<{ kind:'delta', text } | { kind:'finish', reason }>
  映射：StreamChunk.text-delta -> delta
        StreamChunk.finish.reason.kind = 'ok' | 'aborted' | 'error'
        error 时抛出具名 code（AUTH / RATE_LIMIT / NO_ADAPTER / ABORTED …）
```

本轮 `llm` 只允许注入**假对象**；真实调用需同时满足：用户显式开启"真实模型"、Host 侧
`DSH_LIVE2D_CHAT_REAL=1`、以及一次人工审批（见交接文档 §22 的准入清单）。

## 9. 双模式职责（本轮定稿）

| | follow（陪伴） | pet（独立聊天） |
| --- | --- | --- |
| 数据来源 | 用户明确选择的 DSH 会话 | 独立上下文（有界内存历史，默认 6 轮） |
| 是否调用 LLM | **否**（只读展示） | 是（本轮仍是模拟后端） |
| 展示内容 | 用户可见文本 + 状态 | 模型回复 |
| 禁止 | 推理过程、工具结果、密钥、内部日志 | 文件修改/Shell/Git 等工具能力 |
| 关闭后 | 立即退订 | 取消在途请求并释放 |

本轮 follow 仍用模拟消息验证显示链路；真实订阅入口在下一阶段单独实现。

## 10. 兼容与回退

- `desktop-bridge.json` 协议不变；旧版 Electron 读不到 `host-bridge.json` 时行为与现在完全一致（本地模拟）。
- 新增环境变量 `DSH_LIVE2D_HOST_BRIDGE=0` 可关闭 Host 侧桥接（排障用）。
- 删除 `host-bridge.json` 等同于"Host 不在线"，无需改配置。
