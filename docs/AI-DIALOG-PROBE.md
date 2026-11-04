# AI 对话只读 Probe 报告（第四阶段）

调查时间：2026-11-04。调查对象：本机 DSH **0.2.1-rc.5**、插件 `dsh-deepseek-live2d@0.7.3`（`dev/features`）。
方式：**只读**阅读已安装包的类型声明、官方同版本源码与文档、本机 Profile 的非敏感配置结构。
**未发出任何真实推理请求，未读取或输出任何 API Key，未改动 provider/model 设置。**

依据版本：`github.com/deepseek-ai/deepseek-harness` 标签 `dsh-v0.2.1-rc.5`。

## 1. 插件能否注入 llm 服务

**能。** `@deepseek-ai/dsh-llm` 用 Cordis 声明合并把服务挂到 Context 上：

```ts
declare module '@deepseek-ai/cordis' {
  interface Context { llm: LlmRuntime }
  interface Events {
    'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>
  }
}
```

来源：[`packages/llm/llm/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/llm/llm/src/index.ts)。
本机 Profile 的 bundle 列表包含 `@deepseek-ai/dsh-base`（`~/.dsh/profiles/desktop/package.json`），`llm` 由该 bundle 提供；
插件侧只需 `export const inject = ['llm']`，服务未挂载时 Cordis 会让插件等待而不是抛错（与现有 `webServer`/`credentials` 同一机制）。

## 2. `ctx.llm.stream()` 的真实签名

```ts
stream(options: GenerateOptions): AsyncIterable<StreamChunk>
prepareCall(config: LlmCallConfig, signal?: AbortSignal, configure?: ConfigureCall): Promise<PreparedLlmCall>
listProviders(): LlmProviderInfo[]
listModels(provider: string): Promise<LlmModelInfo[]>
resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>
resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig>
```

- `GenerateOptions` 必填 `provider` / `model` / `messages`，可选 `system`、`temperature`、`maxTokens`、`stop`、`signal`。
- 返回的是**原始分片流**（`text-delta`、`block-end` 等），不是字符串；完整文本要自己拼。
- `prepareCall()` 用于「配置能力解析 + 一次派发」绑定同一代 adapter，防止 HMR 期间把 A 适配器的能力配到 B 适配器上；
  返回的 `PreparedLlmCall.stream()` 只能派发一次，配置被改动会抛 `INVALID_PREPARED_CALL`。
- 所有调用都经过 `llm/stream` waterfall，可被中间件拦截/重放/路由。

## 3. provider / model 的合法来源

| 来源 | 说明 |
| --- | --- |
| `ctx.llm.listProviders()` | 当前已注册的 provider 路由（如 `deepseek-account`） |
| `ctx.llm.listModels(provider)` | 该 provider 声明的模型目录（GUI 选择用；核心路由不强制目录成员） |
| `ctx.agentDefaultModel` | 本机 Profile 里由 `agent-default-model` 插件配置：`provider: deepseek-account` / `model: deepseek-flash` / `reasoningEffort: high`（`~/.dsh/profiles/desktop/cordis.patch.yml` 第 6–9 行） |
| `sessionController.modelCatalog()` | Host 代模型目录：部署默认、可路由 provider 分组、隔离的 provider 失败 |

**取"当前已选模型"**的推荐顺序：`agentDefaultModel` 的解析结果 → 失败时退回 `modelCatalog().default` → 再失败则不发起调用，
把「当前 DSH 未配置模型」显示在气泡里。**不要**把 provider/model 写死在插件里。

## 4. 不可用 / 超时 / 流中断 / 用户取消的识别

- **取消**：传 `options.signal`；abort 后适配器与迭代器会收尾，终止分片是 `{ type: 'finish', reason: { kind: 'aborted', failure } }`。
- **适配器/迭代失败**：统一转成终止分片 `{ type: 'finish', reason: { kind: 'error', failure } }`，`failure` 含稳定 `code`
  （`AUTH`、`RATE_LIMIT`、`NO_ADAPTER`、`ABORTED`、`INVALID_*` 等）与可选 `status`、`requestId`、`providerRetryAfterMs`。
- **模型不可用**：`NO_ADAPTER` / `INVALID_MODEL_INFO` / `UNSUPPORTED_REASONING_EFFORT` 是配置类错误，应在派发前暴露。
- **超时**：库里没有独立的"总超时"参数，需要调用方自己 `AbortSignal.timeout(ms)` 或组合信号；
  网络层不会替我们判超时。
- **流中断**：表现为流提前 `return`（没有 `finish` 分片）或抛错；消费方必须把"没有 finish"当成异常收尾。

> 结论：错误与取消都能识别，但**超时、空流、无 finish** 这三类要自己在消费端兜底。

## 5. `ctx.sessionController.prompt()` 能否复用现有会话

能，但它是"投递"而不是"问答"：

```ts
prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<SessionPromptValue>
```

返回的是「Agent 已接受」的回执，**不含回答**；回答要从 `session/event`（`assistant/message`）或 `follow()` 流里取。
好处是自动获得 DSH 的会话历史、工具循环、系统提示词与持久化；代价是桌宠说的话会进入该会话的上下文。

## 6. 能否创建独立会话（不污染开发 Agent）

**能。** 两条路：

- `ctx.sessionController.create(request)`（Remote）：创建普通会话，返回 `SessionCreateValue`；
- `ctx.sessions.create(id?, options?)`（Host）：在当前 fiber 下创建会话，fiber 卸载时自动移除。

`session/event(this: Scoped<Session>, session, event)` 是**按 agent scope 过滤**的 post-commit 事件，
插件只订阅自己创建/进入的会话即可，不会看到开发会话的正文。会话日志 append-only，
`assistant/message` 带完整内容与流记录，适合做桌宠自己的历史。

## 7. 如何避免消息正文、历史与 Key 进日志

- **Key**：只在 Host 侧由 `ctx.credentials.resolve()` 解析；`llm` 适配器内部使用，插件不应接触明文。
  官方 `assertUsableApiKey()` 明确「key 永远不进 message」——错误信息只给引用名，不回显任何片段。
- **正文**：本插件的 `createFileLogger()` 只写自己拼的行；所有 `log()` 调用不得包含 prompt/回答。
  新增对话模块时约定：日志只写长度、分片数、失败码，不写内容。
- **历史**：不要写进 `preferences.json`；需要短期记忆就放内存环形缓冲，进程退出即失效。
- **落盘**：桌面窗口的 `desktop.log` 与本插件日志都在 `~/.dsh/live2d/logs/`，同样适用上述规则。

## 8. 插件生命周期、注入与卸载

- `export const inject = ['llm', 'webServer', 'credentials']`：所需服务就绪后才 `apply()`；服务消失时 Cordis 会走卸载。
- `ctx.effect(() => () => cleanup)`：返回的清理函数在插件禁用/卸载/HMR 时执行——本插件已用它关 viewer、退订事件、清定时器。
- `ctx.on(event, handler)` 返回退订函数；`ctx.webServer.register({...})` 返回注销函数。
- 注册到 `llm` 的适配器/路由同样挂在 fiber 上（`ctx.effect`），卸载即释放。
- 结论：对话模块应把「路由注册、会话、AbortController、定时器」全部收进一个 `ctx.effect`，保证热重载不留孤儿。

## 9. A / B 两种会话模式对比

| 维度 | A：跟随当前开发会话（只展示） | B：桌宠专属会话（可对话） |
| --- | --- | --- |
| 数据来源 | `session/event` 的 `assistant/message` / `user/message` | `sessionController.create()` + `prompt()`，或 `ctx.llm.stream()` |
| 实现难度 | 低：只订阅 + 拼接分片 + 气泡展示 | 中：建会话、发 prompt、取事件、错误与取消处理 |
| 额外费用 | **0**（不发起调用） | 每条用户消息一次模型调用 |
| 上下文隔离 | 无隔离（看到的是开发会话内容） | 完全隔离，可独立清理 |
| 延迟 | 实时跟随，无额外往返 | 受模型与网络影响 |
| 隐私 | 开发正文会出现在桌宠气泡里 | 只在桌宠会话内 |
| TTS 接入 | 只能朗读开发回答（较长、含代码） | 可控制语气、长度，更适合朗读 |
| 与 Agent 竞争 | 无 | 并发调用可能占用配额/并发限制 |
| 推荐用途 | "她陪我干活"的陪伴感 | "单独和她聊天" |

**结论**：A 可以立刻做且零成本；B 是真正的对话能力但需要会话与费用控制。
你的倾向（A+B 同时支持）在接口上可行：A 用 `session/event` 订阅，B 用专属会话，二者由同一个 `chat.mode` 开关切换。

## 10. 推荐的最小 AI 架构

```
渲染器「说话/倾听」按钮
  ├─ mode=follow：订阅 Host 推来的 session/event 摘要（只读，不调模型）
  └─ mode=pet   ：POST /features/chat {text} → SSE 分片
                   Host: 专属 session（sessionController.create 一次）
                         prompt() 投递 → 监听 session/event → 转发 assistant/message 分片
  渲染器：fetch + ReadableStream 读取分片 → 气泡逐字显示；AbortController 取消
```

- **路由**：`POST /features/chat`（同源 + 现有 token 路径 + 独立请求体上限，建议 8 KiB），响应 `text/event-stream`。
- **配置**：`preferences.json` 增 `chat: { enabled:false, mode:'follow', maxTokens:256, historyTurns:6, persona:'' }`，默认关闭。
- **限流**：每分钟 ≤ 6 次、单条 ≤ 500 字、并发 1；超限直接回 429 并在气泡里说明。
- **取消**：渲染器断开 → `AbortController.abort()` → 同时取消 `prompt` 的等待与转发；不让孤儿请求继续计费。
- **测试**：注入假 `llm`（async generator）与假 session，覆盖分片、空流、无 finish、错误码、取消；**不调真实接口**。
- **推进顺序**：① 只读 Probe（本轮已完成）→ ② 假 llm 打通 SSE 与气泡 → ③ 用户确认后才接真实调用并显示计费提示。

## 11. 两个提前标记的架构风险

### 风险一：`EventSource` 不支持 POST 请求体

原设计的 `POST /features/chat` + SSE 组合，**不能**用浏览器原生 `EventSource`（它只发 GET、不能带 body/自定义头）。

| 方案 | 做法 | 评价 |
| --- | --- | --- |
| **fetch + ReadableStream（推荐）** | `fetch(url, {method:'POST', body, signal})`，用 `response.body.getReader()` + `TextDecoder` 解析 `data:` 行 | 同源、可带 token、可取消、Chromium 支持稳定；需要自己写 ~40 行 SSE 解析 |
| 两步法 | `POST /features/chat` 返回一次性 ticket，再 `GET /features/chat/stream?ticket=…` 用 EventSource | 兼容性最好，但多一次往返、ticket 需要过期与单次使用 |
| WebSocket | 升级到 ws | 现有架构是 HTTP/SSE，引入新协议成本最高 |

注意：`fetch` 流式响应在 iframe 内同样可用；但要在 `res.flushHeaders()`，并禁用压缩缓冲，否则会攒包。

### 风险二：desktop 与 overlay 可能共用同一份 `preferences.json`

**确实存在覆盖风险，判断为「中高」。**

- 现状：overlay 模式写 `<configDir>/preferences.json`（`src/index.js`），desktop 模式在本轮修复后也写
  `<configDir>/preferences.json`（`desktop/main.mjs`）——**同一个文件**。
- `createPreferences()` 在进程启动时读一次文件进内存，之后每次 `update()` 都是
  「内存对象 + patch → 整份写回」，**不会重读磁盘**。
- 因此：两个进程（例如 DSH 浮层 + 手动 `npx dsh-live2d-desktop`）同时运行、或先后各改一处，
  后写的一方会用它启动时的旧快照覆盖对方的字段（典型：桌面端启动较早，用户随后在浮层改了 `overlay.left`，
  桌面端再改互动设置时把 `overlay` 写回旧值）。
- 同一进程内不会发生（只有一个 viewer）。

**建议（本轮不实现）**：

1. 文件级互斥（写前 `open(...,'wx')` 锁文件 + 超时），或
2. 写前重读 + 只合并自己负责的段（compare-and-write），或
3. 按模式分文件：`preferences.desktop.json` / `preferences.overlay.json`，只在共享段上做合并。

**测试建议**：用两个 `createPreferences()` 实例指向同一临时文件，A 写 `overlay`、B 写 `interaction`，
断言两者共存；再模拟"B 先读旧快照、A 写入、B 写入"，复现字段丢失。这两种用例可以直接放进 `test/features/`。
