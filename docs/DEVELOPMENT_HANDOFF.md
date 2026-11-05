# 开发交接中心（Development Handoff）

更新时间：2026-11-04（Asia/Shanghai）。维护者：本轮副机（DSH / DeepSeek）。

本文件是**双设备、双模型平行开发**的唯一状态入口。所有结论以 GitHub 远程仓库、当前源码和可复现测试为准；
对话记忆、其他设备的本地工作区、历史文档都不能替代本仓库的事实。

> **本轮状态：本文件与 `AGENTS.md` 都是本地新建草稿，尚未 commit / push。**
> 建立分支 `dev/features` 后写入，用户确认后再提交。

## 1. 仓库与版本基线

| 项目 | 当前依据 |
| --- | --- |
| 远程仓库 | `https://github.com/hjw200775-ops/dsh-live2d-pet`（public，默认分支 `main`） |
| npm 包名 | `dsh-deepseek-live2d`，版本 `0.7.3`（见 `package.json`） |
| **稳定基线 Commit** | **`63acf4143ff8f5547a0f980fb91f4f45e1ce73ea`**（`main`，2026-11-02 18:34:38 +0800，`0.7.3: 完成阶段A待机自然化与自然注视实机验收`） |
| 最新 Tag | `v0.7.3` → `fb7edce`（比基线早 2 个提交，tag 指向的是「鼠标跟随」那一版） |
| 最新 Release | `v0.7.3`（2026-11-01T16:32Z，附件 `dsh-deepseek-live2d-0.7.3.tgz`） |
| 远端分支 | `main`、`codex/stage-a-idle-sway`、`codex/stage-a-natural-idle` |
| 基线规模 | 96 个已跟踪文件；`src/` 36、`test/` 28、`scripts/` 8、`docs/` 6、`renderer/` 4、`desktop/` 3 |

### 1.1 仓库身份确认（防止认错仓库）

- `hjw200775-ops` 名下与桌宠相关的仓库**只有这一个**；另有 `Publish-to-npm`（空仓库）和 `MyAI`（Python，无关）。
- **注意**：`package.json` 的 `homepage` / `bugs` / `repository`，以及 0.7.3 及更早的 Release 正文里，写的是带结尾横线的
  `dsh-live2d-pet-`。该名称是**仓库改名前的旧名**，GitHub 目前仍会重定向到 `dsh-live2d-pet`（实测
  `api.github.com/repos/hjw200775-ops/dsh-live2d-pet-` 返回 200 并给出 `full_name: dsh-live2d-pet`）。
  也就是旧链接**暂时还能用**，但依赖重定向不可靠。**规范地址一律用 `dsh-live2d-pet`**，代码内链接待专项修正。
- 判断依据是 remote、`package.json` 的包名与 README 内容一致，而不是仓库名相似。

### 1.2 GitHub 上尚未合并的实验（不得当作基线）

以下分支**没有合并进 `main`**，它们的代码和文档都不代表稳定版：

| 分支 | 领先 `main` | 内容 | 处置 |
| --- | --- | --- | --- |
| `codex/stage-a-idle-sway` | 3 个提交（`e5373c7`、`117d323`、`504e1d9`） | 久待身体摆动 `rest-sway.mjs`、双腿轻抖 `leg-shake.mjs`、以及一套旧版交接文档 | **实验，未验收合并**；本轮不读取、不合并、不复用其代码 |
| `codex/stage-a-natural-idle` | 4 个提交（`cf3d2d4`、`968d6c4`、`cc459f6`、`21c4e8a`） | 待机自然化与鼠标跟随的中间版本 | 其中大部分已通过 `main` 收敛，仅作历史参考 |

**重要区分**：GitHub 上的 `codex/stage-a-idle-sway` 分支带腿抖代码；而**稳定基线 `main` 完全没有腿抖与久待摆动**
（`src/runtime/leg-shake.mjs`、`rest-sway.mjs` 在 `main` 中不存在）。因此本轮基线按 `main` 处理，
腿抖作为**未合并实验**记录，禁止当作既有功能引用或发布。

### 1.3 版本对照（npm ↔ GitHub）

| 渠道 | 版本 |
| --- | --- |
| GitHub Tags（15） | 0.6.0–0.6.5、0.6.7–0.6.11、0.7.0–0.7.3（**无 0.6.6**） |
| GitHub Releases | 0.6.0 起每版一个 tgz 附件；模型 zip 挂在 0.6.0 及之后，后续版本正文指回 0.6.5 的链接 |
| npm `dsh-deepseek-live2d`（11） | 0.6.0、0.6.1、0.6.3、**0.6.6**、0.6.7、0.6.8、0.6.10、0.6.11、0.7.0、0.7.1、**0.7.3**（latest，`gitHead` = `fb7edce`） |

**不一致项**：npm 缺 0.6.2 / 0.6.4 / 0.6.5 / 0.6.9 / 0.7.2；npm 多出 0.6.6（无对应 tag）。
`0.7.3` 的 npm 产物对应 tag `fb7edce`，**不是**当前基线 `63acf41`。维护 `CHANGELOG.md` 与版本对照表时应以这张表为准。

## 2. 平行开发机制

| 角色 | 负责内容 | 分支 | 主要写入范围 |
| --- | --- | --- | --- |
| **主机：GPT Codex** | Live2D 动画、模型变形、动作与物理调优、观感验收 | `codex/<阶段>-<主题>` | `renderer/viewer.js` 的动画/参数层、`src/runtime/` 的动画模块、`desktop/` 的窗口表现 |
| **副机：DSH / DeepSeek** | 功能模块、交互逻辑、配置管理、AI 对话、TTS | `dev/features`（本轮已建） | `src/index.js`、`src/activity.js`、`src/bridge.mjs`、`src/viewer-server.js`、`src/preferences.js`、`src/desktop/preferences.mjs`、`scripts/`、`client.js`、新增 `src/features/` 与 `test/features/`、`docs/` |

规则：

1. `main` 只能由人工在验收后合并，任何设备不直接提交 `main`，不 force push、不 hard reset。
2. 一台设备一个工作区：同一工作区同时只允许一个会话写入；换设备前先在本文档登记状态。
3. 每个功能一个分支，从最新稳定基线切出；合并前必须基于 `main` 重新 rebase 或 merge 并重跑测试。
4. 动画实验分支与功能分支互不合并，只有在双方都验收后才会经 `main` 汇合。

## 3. 文件归属（谁可以改）

| 区域 / 文件 | 归属 | 说明 |
| --- | --- | --- |
| `renderer/viewer.js` 的动画与参数叠加（`tick`、`valueAt`、物理层、motion 调度） | 主机 | 副机不改这段 |
| `renderer/viewer.js` 的 UI 面板事件绑定（`panel` 的 `data-act` 分支） | 副机 | 只允许在既有分支结构里新增条目，改前登记 |
| `src/runtime/blink.mjs`、`breathing.mjs`、`gaze.mjs`、`look.mjs`、`noise.mjs`、`fades.mjs`、`fidget.mjs`、`gesture.mjs`、`motion-policy.mjs`、`authored-motions.mjs`、`natural-overlay.mjs` | 主机 | 动画观感相关 |
| `src/runtime/balance.mjs`、`model-hit.mjs`、`click-motion.mjs`、`wardrobe.mjs`、`frame-pace.mjs`、`host-exit.mjs` | 共用（改动需登记） | 功能与动画都被引用 |
| `src/index.js`、`src/activity.js`、`src/bridge.mjs`、`src/viewer-server.js`、`src/preferences.js`、`src/desktop/*`、`scripts/*`、`client.js` | 副机 | 事件、路由、配置、脚本 |
| 新增 `src/features/*`、`test/features/*` | 副机 | 功能模块一律新建文件，尽量不改动既有模块 |
| `src/model.js`、模型 / Core 资源、`*.model3.json`、`*.physics3.json` | 只读 | **禁止修改**模型、动作参数、变形器、物理配置 |
| `package.json` / `package-lock.json` | 共用 | 版本号与依赖变更需双方确认 |
| `docs/DEVELOPMENT_HANDOFF.md`、`AGENTS.md` | 共用 | 交接时更新自己那一段，不覆盖他人结论 |
| `README.md` | 共用 | 面向用户的描述，改前登记 |

## 4. 共享文件冲突风险

| 文件 | 冲突点 | 规避方式 |
| --- | --- | --- |
| `renderer/viewer.js`（512 行） | 动画循环与设置面板在同一文件，最容易冲突 | 主机只改动画段（L300–L510 参数层）；副机只改 L183–L299 的交互/面板段；新功能一律拆成 `src/features/*` 与 `renderer/features/*` 后在少量挂载点引入 |
| `src/viewer-server.js` | 路由表被功能（新 API）和渲染器（静态资源）同时改 | 新增功能禁止直接写在 `createServer` 里；改为注册 `featureRoutes` 数组，单点接入 |
| `src/activity.js` | 状态机被两边引用（动画切换 + 功能触发） | 状态枚举固定为 `idle/thinking/answering/error`；新增状态需双方确认 |
| `src/index.js` | 事件订阅与 `webServer` 注册集中在此 | 新功能的订阅写成独立 `apply` 模块，由 `index.js` 一处 `for` 循环装配 |
| `package.json` | 版本号被两边同时提升 | 只有合并到 `main` 时才统一改版本；功能分支不改版本 |
| `test/*.test.mjs` | 共用测试文件名可能重名 | 新增测试放 `test/features/<name>.test.mjs` |

## 5. 已完成 / 待完成

### 5.1 稳定基线已具备（`main` @ `63acf41`）

- 四状态联动：`agent/status`、`agent/assistant-stream`、`agent/error` → `idle/thinking/answering/error`
- 回环 viewer 服务：令牌保护、模型引用白名单、SSE 推送、偏好读写、telemetry
- 独立透明桌面窗口（Electron 33.4.11，首次自动下载 + sha256 校验）；可选页面内浮层
- 资源自动补齐：模型包自动下载、Cubism Core 检测与导入、`doctor` 自检、日志落盘
- 待机自然化：呼吸、随机连眨、视线漂移、噪声漂移、状态化淡入淡出
- 鼠标跟随：比例映射 + 死区 + 平滑 + 自动回正 + 范围/全屏设置（已持久化）
- 点击交互（**已有雏形**）：命中测试区分头部/身体，单击、双击、气泡文字、动作触发
- 装扮/表情/动作面板（右键菜单、Shift+F10）、暂停/继续、拖动、置顶、随 DSH 退出

### 5.2 待完成（副机方向，均未开始）

- 摸头/长时间悬停等**连续交互手势**（目前只有瞬时 click / double-click）
- 交互开关的用户配置化与持久化（现在气泡文案与触发条件写死在渲染器里）
- AI 对话（需要先确认 DSH 插件侧的模型调用能力，见 §10）
- TTS 语音与口型同步（现有嘴部是正弦示意动画）
- 设置界面统一入口（现在分散在右键面板与两个偏好文件）
- 版本与发布资产：`CHANGELOG.md`、版本功能对照表、npm/Release 对应关系

## 6. 测试与发布检查（按阶段累积）

环境：Windows 10/11 x64、Node **v26.13.0**、npm **11.20.0**、git 2.56.0.windows.4。

| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| 基线盘点 | `npm ci --ignore-scripts` | 成功，107 个包（使用 `package-lock.json`，未升级依赖） |
| 基线盘点 | `npm test` | **112 / 112 通过** |
| 第二阶段（功能） | `npm test` | **132 / 132 通过**（+20 互动配置用例） |
| 第三阶段（审核修订） | `npm test` | **141 / 141 通过**（+5 HTTP 边界、+4 手势语义） |
| 第三阶段收尾（P2 方案 C） | `npm test` | **148 / 148 通过**（+7 双击折叠用例） |
| 第五阶段（存档隔离 + 模拟对话） | `npm test` | **182 / 182 通过**（+7 存档、+27 对话） |
| 发布检查 | `node scripts/check_release.mjs` | **103 个已跟踪文件通过**，无模型/Core/本机路径/密钥 |
| 仓库完整性 | `git ls-remote` | `origin/dev/features` = 本地 `HEAD`，ahead/behind 0/0 |

测试脚本为 `node --test test test/features`（第二阶段起），否则 `test/features/` 下的用例不会被收集。

> Windows / PowerShell 直接执行 `node --test test/*.test.mjs` 会因通配符未展开而报「0 个测试」。
> 请用 `npm test`。这是平台差异，不是测试回归。

## 7. 已知问题

| 问题 | 影响 | 处理 |
| --- | --- | --- |
| `package.json` 与 Release 正文的仓库链接带结尾 `-`（`dsh-live2d-pet-`） | 链接 404，用户找不到 Release/模型包 | 待专项修正，涉及 `package.json` 3 处、`README.md`、`src/viewer-server.js` 的报错文案、历史 Release 正文（正文不可改，只改代码内链接） |
| README 版本信息滞后：写 `0.6.10`、测试数 `30`、仓库链接带 `-` | 误导用户与接手者 | 在功能分支统一更新，需要一次单独提交 |
| `main` 缺少 `AGENTS.md` 与交接文档 | 新会话没有入口，容易重复摸索 | **已在 `dev/features` 补上并推送**；合并到 `main` 后才会对基线生效 |
| 两条 `codex/*` 分支长期未合并 | 远端分支与基线持续分叉，容易误用 | 由用户决定「合并 / 归档 / 删除」，本轮不动 |
| 透明窗口无逐像素点击穿透 | 透明区域仍接收鼠标 | 已知限制，非本轮范围 |
| 5 张 4096 纹理占显存 | 低配机可能掉帧 | 已知限制，需主机侧优化 |
| `main` 未开分支保护 | 任何人可直接推 `main` | 流程风险，非代码问题；需要仓库管理员在 GitHub 设置里加保护 |
| 无 `gh` CLI；SSH 无密钥 | 只能用 HTTPS + PAT | 推送前准备凭据，不改动他人凭据 |

## 8. 合并要求

1. 目标分支只能是 `main`，必须走人工确认（用户明确同意）。
2. 合并前：`npm ci --ignore-scripts` → `npm test` 全绿（当前 141 项）→ `node scripts/check_release.mjs` 通过。
3. 涉及 `renderer/viewer.js`、`src/index.js`、`src/activity.js` 的改动，必须在本文档 §3/§4 登记后再合并。
4. 动画类改动**必须有用户视觉验收记录**；自动测试与截图只能作为证据，不能替代人工确认。
5. 不得合并未经验收的腿抖/身体摆动实验；不得在合并中夹带 `package.json` 版本号与发布动作。
6. 禁用：force push、`reset --hard`、删除远端分支、改写历史。

## 9. 当前工作区状态

| 项目 | 值 |
| --- | --- |
| 工作目录 | 副机本地克隆（仓库根目录，路径因机器而异，不进文档）；未使用其他设备的实验代码 |
| 当前分支 | `dev/features`，跟踪 `origin/dev/features`，与远端一致（ahead/behind 0/0） |
| 基线 | `main` = `63acf41`，未被修改 |
| 依赖 | 已按锁文件安装到本地 `node_modules`（不入库） |
| 待人工决策 | 双击关闭后的交互语义（§16） |

## 10. 任务队列（按优先级，均已获用户授权范围约束）

| 状态 | 任务 |
| --- | --- |
| ✅ 已完成 | 交互反馈配置化（摸头/单击/双击开关、气泡文案、冷却、恢复默认） |
| ✅ 已完成 | P1：preferences 请求体上限与错误反馈（§15） |
| ⏸ 待人工选择 | ~~P2：双击语义 A / B~~ → **已定方案 C 并实现**（§16） |
| ⏳ 待授权 | 设置项迁移到 DSH 原生 `Config`（§13） |
| ✅ 已完成 | AI 对话只读 Probe（接口/会话/生命周期/日志边界，见 `docs/AI-DIALOG-PROBE.md`） |
| ✅ 已完成 | 存档隔离：desktop 用 `preferences.desktop.json`，overlay 保持 `preferences.json`，首次启动安全迁移 |
| ✅ 已完成 | 模拟 AI 对话 MVP（follow / pet 双模式、SSE、停止、取消/超时/空流/错误处理，**全部假模型**） |
| ✅ 已完成 | 隔离 GUI 验收工具化（`tools/gui-check/`） |
| ⏳ 待授权 | AI 对话实现（先假 llm 打通，再谈真实调用） |
| ⏳ 待排期 | README 版本与链接纠偏、`CHANGELOG.md`、版本对照表 |

**需要主机 Codex 协助的部分**（本轮未动）：摸头/悬停手势对应的身体与头部动画曲线、点击反馈的动作组合选型、
口型与眨眼之外的微表情联动。这些涉及 `renderer/viewer.js` 动画层与 `LEGAngleZ2` 一类物理参数，副机不单方面修改。

**AI 对话与 TTS**：结论见 §13；在用户确认前不引入任何新 API 服务、付费依赖或模型资产。

### 10.1 DSH 宿主能力调研（2026-11-04，本机实测）

对 DSH 安装目录下的 `resources\app.asar` 做了二进制字符串扫描（安装路径因机器而异，不写入文档），
证据为包内代码片段，结论如下：

| 能力 | 宿主是否具备 | 证据 | 对插件的可用性 |
| --- | --- | --- | --- |
| LLM 服务 | **有**，服务名 `llm` | 包内 `dsh-llm-deepseek-api-key` / `llm-deepseek-account` 均 `const inject = ["llm"]`；详见 §13（`ctx.llm.stream()`） | 存在，但属于适配器级 API（不自动带会话/工具/系统提示词），**不是**一行 `chat()`；需专项试验后再定方案 |
| 会话/消息事件 | **有** | `this.dispatch.emit("agent/assistant-stream", { frame })`；文档片段说明「render live tokens from `agent/assistant-stream`，Do not poll `agent/status`」 | 已在本插件使用；frame 内含 `text-delta`，可拿到回复文本流 |
| 语音识别（ASR） | **有** | `SpeechController`（`super(ctx, "speechController", { namespace: "speech" })`，`inject = ["speechToText", "typert"]`，方法 `catalog/follow/configure/prepare/cancelPreparation/transcribe`） | 面向浏览器录音转写，与桌宠场景关系不大 |
| 语音合成（TTS） | **仅随包带了引擎，未发现对外服务** | `node_modules/sherpa-onnx-node/non-streaming-tts.js`（含 `createOfflineTts`）随宿主分发；但扫描未发现类似 `speechToText` 的 TTS 服务/Remote | 插件理论上可自带 sherpa-onnx 离线模型自建 TTS，但属于**新增依赖与模型资产**，需用户批准 |
| 插件设置界面 | 通过 cordis 配置 + 客户端插件自绘 | 本仓库已用 `cordis.patch.yml` 的 `config` 与 `client.js` 自绘浮层 | 沿用现有模式即可，无需新框架 |

**因此**：AI 对话优先「试验 `ctx.llm` 的适配器级调用」；TTS 若要做，先用**本地 sherpa-onnx 离线合成**（不引入付费云服务），
两者都必须先经用户确认，且不得把密钥写进仓库（走 `ctx.credentials`）。


## 11. 环境记录

- DSH 安装目录：由用户本机决定（不写入文档），运行时 Node 24.21.0（见安装目录内 `resources/runtime/versions.json`）
- 插件 `engines`：`node >=22.12`、`dsh ^0.2.0-rc.2`
- 模型与 Cubism Core：**不在仓库内**，不入库、不提交
- 模型署名：Kamiya Ryoko（神宫凉子）绘制，霓虹猫_NeonNeko 绑定；再分发授权见 `docs/permission.md`

## 12. 第二阶段：交互反馈配置化（dev/features）

### 12.1 范围

在**不改动**任何 Live2D 动画曲线、物理参数、模型资源的前提下，把原先写死在 `renderer/viewer.js` 里的交互反馈
（摸头、身体单击、双击、气泡文案、冷却）改成用户可配置，并持久化到现有 `preferences.json`。
本轮不接入 AI 对话与 TTS。

### 12.2 配置结构与默认值

配置文件仍是 `~/.dsh/live2d/preferences.json`（浮层模式）或桌面窗口的 userData 内同名文件，新增一段 `interaction`：

```json
{
  "version": 1,
  "overlay": { "left": 0, "top": 0 },
  "model": { "zoom": 1, "x": 0, "y": 0 },
  "interaction": {
    "version": 1,
    "enabled": { "head": true, "body": true, "double": true },
    "bubbles": { "head": ["嗯？", "在的", "嘿嘿"], "body": [], "double": ["嘿嘿！"] },
    "cooldownMs": 650
  }
}
```

**默认值刻意等于 v0.7.3 的硬编码行为**：三个开关全开、冷却 650 毫秒、摸头三句随机、双击「嘿嘿！」、
身体单击不弹气泡（只做注视）。老存档没有 `interaction` 段时自动补默认值，行为不变。

### 12.3 校验规则（服务端与渲染器共用同一份）

- 开关：只接受 `boolean`，其他类型保留旧值；
- 冷却：只接受 `0…10000` 的有限数字，四舍五入取整，越界/`NaN`/字符串保留旧值；
- 气泡：必须是字符串数组，逐条 `trim`、丢弃空串、单条截断 40 字、最多 12 条；空数组 = 这一类不弹气泡；
- 未知字段丢弃；返回值永远是完整结构；函数不修改入参与上一份配置；
- 手写坏掉的 `interaction` 段在读取时会被就地修正，不会导致启动失败。

### 12.4 修改文件

| 文件 | 改动 |
| --- | --- |
| `src/features/interaction-preferences.mjs` | **新增**：默认值、边界常量、`sanitizeInteractionPreferences()`、`pickBubble()`、文本互转 |
| `src/preferences.js` | 把 `interaction` 并入 `sanitizePreferences()`，老存档补默认值 |
| `src/viewer-server.js` | 静态资源新增 `src/features/` 整目录放行（与 `runtime/` 同规矩） |
| `renderer/viewer.js` | 引入配置模块；`react()` 读取开关/冷却/气泡；新增面板事件绑定（约 40 行） |
| `renderer/index.html` | 新增「互动反馈」设置区（3 个开关、冷却、3 个气泡输入、恢复默认按钮） |
| `renderer/style.css` | 该设置区的样式 |
| `package.json` | 测试脚本改为 `node --test test test/features` |
| `test/features/*.test.mjs` | **新增** 20 项测试 |
| `test/activity.test.mjs` | 存档结构断言补上 `interaction` 默认段（行为不变） |

**为什么必须动 `renderer/viewer.js`**：交互事件（`react()`）、气泡（`say()`）和面板都在该文件内，
不引入事件总线就不存在"完全零改动"的方案。改动被限制在：一行 import、`react()` 内的分支、
以及一段独立的面板绑定代码；动画/物理/动作调用一行未动。

### 12.5 手动验收步骤

1. 装好插件并启动桌宠（独立窗口或浮层均可）。
2. 右键（或 Shift+F10）打开设置 → 找到「互动反馈」。
3. 关闭「摸头反馈」→ 点头部：不再点头、不弹气泡；点身体仍正常。
4. 关闭「身体单击反馈」→ 点身体无反应；恢复开关后正常。
5. 关闭「双击反馈」→ 双击无反应。
6. 冷却设为 `2000` → 连续快速点头部，只有第一次生效；改回 `650` 后恢复。
7. 摸头气泡改成「喵，在的，别摸」→ 点头部只出现这三句之一；改成空 → 不弹气泡但仍有点头动作。
8. 点「恢复默认互动设置」→ 所有项回到 v0.7.3 行为。
9. **退出并重启 DSH**，确认以上设置全部保留。
10. 回归：鼠标跟随、装扮、动作面板、暂停、拖动、四状态切换表现与之前一致。

> 注意：透明窗口下设置面板靠右键唤起；若面板里没有「互动反馈」一节，说明渲染器没有更新到本分支。
>
> 另注：**点击类反馈本身只在独立桌面窗口模式生效**（`viewer.js` 里 `react()` 位于 `desktopApi` 分支内，这是 v0.7.3 的既有结构，本轮未改）。
> 页面内浮层模式下面板仍会显示这些设置并正常保存，只是不会有点击反应。

### 12.6 本轮测试（第二阶段时点，后续阶段已增至 141）

- `npm test`：**132 / 132 通过**（112 原有 + 20 新增；其中 14 项配置校验、6 项持久化/接线）。
- 覆盖点：默认值等价 v0.7.3、非对象输入、布尔严格校验、未知字段、冷却 `0 / 10000 / -1 / 10001 / NaN / Infinity / 字符串`、
  冷却取整、气泡去空白/截断/限量/非字符串、空气泡、纯函数性、恢复默认不污染常量、`pickBubble` 边界、
  老存档升级、往返持久化、非法更新回退且文件不损坏、坏存档修正、features 目录暴露、面板控件齐全。
- `node scripts/check_release.mjs`：通过（无模型/Core/本机路径/密钥）。

## 13. AI 接口预研（只读，未调用任何收费接口、未读取密钥）

调研方式：只读查看本机 Profile 配置、已安装包的类型声明，以及 DSH 官方文档（版本 `dsh-v0.2.1-rc.5`）。
本机 DSH 版本 `0.2.1-rc.5`，插件 `engines.dsh: ^0.2.0-rc.2` 在 DSH 的 `includePrerelease: true` 规则下**匹配**。

| 项目 | 结论 |
| --- | --- |
| 服务目录 | `ctx` 由当前 Profile 组合 bundle 决定；desktop Profile 已加载 `dsh-base` + `dsh-web-app`，可用 `llm`、`sessions`、`agents`、`sessionController`、`settings`、`credentials`、`webServer` 等；**没有** `session`/`agent`/`api`/`prompt` 这类顶层服务名 |
| 能否主动调用模型 | **可以**。Host 插件 `inject = ['llm']` 后调用 `ctx.llm.stream({ provider, model, messages, signal })`，返回 `AsyncIterable<StreamChunk>`，消费完整流即得非流式结果；没有 `chat()` 便捷方法 |
| 调用层级 | 适配器级：不会自动带 Agent 的会话、工具循环、系统提示词与历史。要保留 DSH 会话语义，应走 `ctx.sessionController.prompt()` 或驱动 `ctx.agents`，并监听 `session/event` |
| 消息事件 | `agent/assistant-stream` 的 `text-delta` 只是片段，`end` 不含完整回复；完整消息在 `session/event` 的 `user/message`、`assistant/message`（含完整 content 与流记录）。当前 `activity.js` 有意只取状态、丢弃 `text`，做对话时需新增文本聚合或改听 `session/event` |
| 浏览器侧限制 | 浏览器 Context 不等于 Host Context，`ctx.llm.stream()` 未标为 Remote，不能直接调用；正确做法是由 Host 插件在 `webServer` 上新增对话路由，服务端调用 `ctx.llm` 后以 SSE/JSON 下发，**不向浏览器传密钥** |
| 凭据 | `ctx.credentials.resolve(name)` 只返回解析结果，插件不应落盘、日志输出或转发 |
| TTS | **宿主没有 TTS 服务**（服务表只有 `speechToText` / `speechController`，官方 README 明确「语音合成没有服务方法」）。随包的 `sherpa-onnx-win-x64` 在 SenseVoice Provider 里只用于 ASR（`OfflineRecognizer` + `Vad`）。要做 TTS 需插件自建（离线模型 / 系统 `speechSynthesis` / 外部进程），属于新增依赖 |
| 设置界面 | 持久选项应走 Host 导出的 `Config` + `ctx.settings`（实时字段用 `Volatile`/`.volatile()` 写入 Profile patch）；`cordis.patch.yml` 只是初始配置，不是 UI API。桌宠专属交互 UI 仍由 `client.js` / 渲染器自绘 |
| 实现难度 | AI 对话：中等（Host 新增一条 SSE 路由 + 流聚合即可，约 1 天量级，但需先确认 provider/model 取值与计费）；TTS：中偏高（选型 + 模型体积 + 授权） |
| 本轮结论 | 只记录，不实现、不引入云服务依赖、不改 DSH 模型配置；下一阶段若推进，先做**不真正调用模型**的 Probe（只验证 `ctx.llm` 能否注入、`provider/model` 从哪读） |

## 14. 第二/第三阶段本地状态

| 项目 | 值 |
| --- | --- |
| 分支 | `dev/features`（从 `63acf41` 切出，已推送并设置 upstream） |
| 远端 | `origin/dev/features`，与本地一致；`main` 仍为 `63acf41` |
| 提交 | `35944dd` 交接文档 → `5b9c3dd` 交互配置化 → `17a4ad6`、`a49657f` 文档补充 → `59fca7d` P1 请求体上限修复 → 最新提交 `fix: 双击反馈关闭时折叠为一次单击（方案 C）`（见 `git log -1`） |
| 未合并 | `main` 未动、`codex/*` 实验分支未动；未发布 npm、未建 Release |

## 15. 第三阶段：审核修订（P1 请求体上限）

### 15.1 问题

`src/viewer-server.js` 原先对 `preferences.json` 和 `telemetry.json` 共用 **2048 字节**上限。
互动气泡允许 3 类 × 12 条 × 40 字，一条最大合法配置实测 **4538 字节**（UTF-8），
必然超过 2048 → 服务端返回 413 → 前端只看到「位置存档写入失败」，设置重启后丢失。

### 15.2 修复

| 改动 | 说明 |
| --- | --- |
| 新增 `REQUEST_LIMITS`（导出常量） | `preferences: 16 KiB`、`telemetry: 2048`、`bridge: 2048`，三个接口分开口径 |
| 新增 `readJsonBody(req, limit)` | 统一读体；超限后**继续排空剩余字节再回 413**（提前 return 会让客户端卡在半开连接上，实测挂死） |
| preferences 上限依据 | 最大合法配置 4538 B ≈ 4.4 KiB，取 16 KiB 留约 3.6 倍余量；仍是明确安全边界，不是无限放宽 |
| 413 / 400 响应体 | 返回 JSON：`{ "error": "payload-too-large", "store": "preferences", "limit": 16384 }` / `{ "error": "invalid-json" }`，前端可据此给出具体提示 |
| 存档保护 | 超限分支在 `preferences.update()` **之前**返回，磁盘文件逐字节不变（有测试断言） |
| 渲染器反馈 | 新增面板状态行 `#save-state`：仅 2xx 显示「设置已保存」；失败显示「未保存：设置太大，没有保存成功（超过 16 KB 上限）」，不再出现"看着存住了、重启丢失" |

### 15.3 证据

```
$ node --test test/features/preferences-http.test.mjs
✔ 最大合法互动配置能通过 HTTP 保存、读回，并在重启后恢复 (64.8ms)
✔ 超过 preferences 上限的请求返回 413 JSON，原存档不被破坏 (16.4ms)
✔ telemetry 与 bridge 保持 2 KiB 紧边界，不被 preferences 的宽松上限带偏 (10.8ms)
✔ 写入仍要求同源 Origin，非法 JSON 回 400 且不写档 (12.8ms)
✔ 渲染器把保存失败显式显示在面板里，而不是假装保存成功 (1.5ms)
tests 5 | pass 5 | fail 0
```

其中「重启后恢复」是真的重建 HTTP 服务：关闭第一个 viewer，用同一份 `preferences.json` 启动第二个再读取。

### 15.4 GUI 验收中发现并修复的持久化缺陷

隔离窗口实测发现：**桌面窗口模式**下 `desktop/main.mjs` 调用 `startViewer()` 时没有传 `preferencesFile`，
于是 `createPreferences(undefined)` 让偏好只存在内存里——缩放、浮层位置、互动设置重启后全部丢失
（overlay 模式因为 `src/index.js` 显式传了文件，所以没暴露）。

修复（`desktop/main.mjs`）：把 `preferencesFile` 指向 `configDir/preferences.json`，与 overlay 模式同一份约定；
桌面窗口自己的窗口/装扮偏好仍写在 userData 的 `desktop-preferences.json`，两份存档互不覆盖。
该修复单独成一个提交，不与 P2 混在一起。

## 16. P2：双击语义（人工决策 = 方案 C，已实现）

**决策**：关闭双击反馈时，快速连续点击两次产生**一次普通单击反馈**；双击反馈开启时完全保留原语义。

实现（只动 `renderer/viewer.js` 的手势入口 + 一个纯函数模块，**未改** `src/runtime/gesture.mjs`）：

| 位置 | 改动 |
| --- | --- |
| `src/features/interaction-preferences.mjs` | 新增 `doubleClickFallbackKind({doubleEnabled, region})` 与 `shouldFireFeedback({kind, enabled, now, lastReaction, cooldownMs})` |
| `renderer/viewer.js` `mouseup` 的 `double-click` 分支 | 原来固定 `react('double')`，改为 `react(doubleClickFallbackKind({doubleEnabled, region: regionAt(e.clientY)}), point)` |
| `renderer/viewer.js` `react()` | 两行开关/冷却判断合并为一次 `shouldFireFeedback(...)` 调用，行为完全等价 |

约束落实：

- 仅 `interaction.enabled.double === false` 时折叠；开启时 `kind` 仍是 `'double'`。
- 一次双击只调用一次 `react()`，因此最多一次反馈。
- 折叠后的 `kind` 是 `head`/`body`，所以**照常走单击冷却**、照常受 `motionLocked`/`gestureLock` 与动作组逻辑约束。
- 目标开关关闭时 `shouldFireFeedback` 返回 false —— 双击无法绕过被关闭的头部/身体反馈。
- 区域按 `e.clientY` 经 `regionAt()` 判定，与普通单击同一条路径。

测试（`test/features/double-click-fallback.test.mjs`，7 项）：开启时保持 double、关闭时按区域折叠、头部关闭不可绕过、
冷却边界（`now-last === cooldown` 可触发）、触发后刷新冷却、`cooldownMs=0` 连续可触发、渲染器接线与
`gesture.mjs` 未被改动。`test/features/gesture-double-semantics.test.mjs` 同步改写为"识别器独吞 + viewer 折叠"。

历史对比（保留备查）：A = 关闭后完全无反馈（原状）；B = 拆成两次单击（需改 `gesture.mjs`，属主机范围，未采用）；
C = 折叠为一次单击（现方案）。

## 17. 隔离 GUI 验收记录与待人工确认

### 17.1 已做的隔离实测（2026-11-04，Electron 33.4.11 + Cubism Core 5.1.0）

条件隔离：独立 `DSH_LIVE2D_CONFIG`（模型/Core 只读引用）、独立 `DSH_DESKTOP_USER_DATA`、独立日志与存档目录，
不触碰正在运行的 DSH、不写入主机 Codex 工作区、不覆盖稳定版本；测完 `taskkill /T` 清理进程，CDP 端口已关闭。

| # | 检查 | 结果 |
| --- | --- | --- |
| 1 | 隔离窗口加载、`__dshDesktopReady` 与 `__dshInteraction` 就绪 | ✅ |
| 2 | 面板「互动反馈」7 个输入控件齐全、默认 650 ms / 全开 | ✅ |
| 3 | 头部/身体命中点可探测 | ✅ |
| 4 | 默认点头部出现气泡 | ✅ |
| 5 | 关闭头部反馈后点头部无反应 | ✅ |
| 6 | **方案 C**：关闭双击后两次快速点击只反馈一次 | ✅ |
| 7 | 双击开启时仍是「嘿嘿！」双击气泡 | ✅ |
| 8 | 中文气泡写入 `configDir/preferences.json` | ✅ |
| 9 | 保存成功提示「设置已保存」 | ✅ |
| 10 | 模拟 413 时显示「未保存：设置太大…」且标红 | ✅ |
| 11 | 保存失败时磁盘未被改写 | ✅ |
| 12 | **重启后互动配置保留** | ✅ |
| 13 | 重启后面板回显已保存的中文气泡 | ✅ |

共 13 项，全部通过。截图证据由 `DSH_DESKTOP_CHECK=1` 模式产出（隔离目录内，不入库）。

### 17.2 仍需人工视觉确认

1. **方案 C 的观感**：关闭双击后快速连点，应只出现一次点头/一次气泡；头部开关关闭时连点头部应毫无反应；
   双击开关开启时行为与之前完全一致。
2. **真实桌面手感**：冷却 650 ms 是否合适、气泡出现位置与时长、与鼠标跟随/装扮/暂停/拖动/四状态切换的组合表现。
3. **合并前检查**：`npm test` 148 项全绿 + `check_release` 103 文件通过 + 用户视觉验收记录。

> 自动化与截图只能证明"代码按预期执行"，不能替代最终观感确认。

## 18. 下一阶段：AI 对话模块最小设计（仅设计，未实现）

前提见 §13：宿主有 `llm` 服务（`ctx.llm.stream()`），没有 TTS；凭据只能由 Host 解析、不得下发浏览器。

**最小闭环**（不做工具调用、不做跨会话记忆、不做语音）：

```
renderer 点击“和她说话”
  → POST /features/chat（同源 + 现有 token 路径 + 独立上限，如 8 KiB）
  → Host src/features/chat/service.mjs
       ctx.llm.stream({ provider, model, messages:[system, ...最近 N 轮], signal })
  → SSE 分片回渲染器 → 气泡逐字显示 → 结束记入内存环形历史（默认 6 轮）
```

| 设计点 | 最小方案 | 理由 |
| --- | --- | --- |
| 注入 | `inject = ['llm']`（可选 + 未挂载时降级为「当前 DSH 未提供模型服务」） | 不新增依赖、不直连 API |
| 配置 | `preferences.json` 新增 `chat: { enabled, maxTokens, persona, historyTurns }` | 与 `interaction` 同一条持久化通道 |
| 默认值 | `enabled: false`、`maxTokens: 256`、`historyTurns: 6`、`persona` 空 | 默认不产生任何计费调用 |
| 安全 | 密钥不出 Host；同源 + token；单条 ≤ 500 字；每分钟 ≤ 6 次；正文不落盘、不写日志 | 复用 §15 边界思路 |
| 取消 | 渲染器断开 SSE → `AbortController` 取消 `ctx.llm.stream` | 避免孤儿请求继续计费 |
| UI | 复用现有气泡；设置面板加「对话」区（开关、人格预设、历史轮数） | 不新增窗口 |
| 测试 | 注入假 `llm`（async generator）验证分片、取消、超时、上游错误；**不调用真实接口** | 可离线、可回归 |
| 风险 | 计费与配额、模型输出长度、NSFW/安全策略、iframe 内 SSE 的 keep-alive | 需在 Probe 阶段逐项确认 |

**推进顺序**：① 只读 Probe（验证 `ctx.llm` 能注入、provider/model 从哪读、不真正请求）→ ② 假 llm 打通 SSE 与气泡
→ ③ 用户确认后才接真实调用并加计费提示。

> **第四阶段进展**：① 已完成，报告见 [AI-DIALOG-PROBE.md](AI-DIALOG-PROBE.md)（含 `ctx.llm.stream` 签名、
> provider/model 来源、错误与取消识别、专属会话方案、A/B 模式对比、以及 EventSource-POST 与
> `preferences.json` 共用两个风险的判断）。②③ 未开始，且完成 ① 后仍未发出任何真实请求。

## 19. 第四阶段：GUI 测试工具与 Probe 归档

| 交付物 | 位置 | 说明 |
| --- | --- | --- |
| 隔离 GUI 验收工具 | `tools/gui-check/run.mjs` + `README.md` | 零新依赖（Node 内置 WebSocket/fetch），20 项检查（含存档迁移与模拟对话），独立 workdir/userData/配置/日志；只按自己记录的 PID 清理，成功失败都收尾并写 `report.json` |
| AI 对话只读 Probe | `docs/AI-DIALOG-PROBE.md` | 8 个问题的结论与证据、A/B 模式对比、最小架构、两个架构风险 |

复跑（Windows）：

```powershell
node tools/gui-check/run.mjs --model "<…>\大肥鱼.model3.json" --core "<…>\live2dcubismcore.min.js"
```

工具默认在 `~/.dsh/live2d/electron/*/electron.exe` 找 Electron；模型与 Core 只读引用，产物全部落在
`%TEMP%\dsh-live2d-gui-check`，不入库。

### 19.1 本轮新增的风险记录（未实现修复）

1. **`EventSource` 不能发 POST**：已在第五阶段落实为 `fetch + ReadableStream` 自研 SSE 解析（`src/features/chat/sse.mjs`）。
2. **desktop / overlay 共用 `preferences.json`**：**第五阶段已修复**——按运行模式分文件（desktop 用
   `preferences.desktop.json`，overlay 保持 `preferences.json`），并带首次启动安全迁移，详见 §20.1。



## 20. 第五阶段：存档隔离与模拟 AI 对话

### 20.1 存档隔离（desktop / overlay）

| 模式 | 存档文件 | 说明 |
| --- | --- | --- |
| overlay（页面内浮层） | `<configDir>/preferences.json` | 保持原行为 |
| desktop（独立窗口） | `<configDir>/preferences.desktop.json` | 本轮新增；首次启动从旧文件**只读复制**一份 |

- 迁移规则：目标已存在 → 完全不覆盖；旧文件缺失/损坏 → 不创建目标，交给默认值；**旧文件永不删除、永不修改**。
- 回退方案：删掉 `preferences.desktop.json`（下次启动会重新迁移），或用 `DSH_LIVE2D_PREFERENCES_FILE` 指定路径；
  想彻底回到单文件，把该环境变量指向 `preferences.json` 即可，无需改代码。
- 两进程各自整份回写的问题因此消失：overlay 与 desktop 不再写同一个文件。

### 20.2 模拟对话（本轮不接真实模型）

**明确标注**：所有回复来自 `src/features/chat/simulator.mjs`，前缀固定 `【模拟】`，响应首帧是
`{"type":"meta","simulated":true,"model":"local-simulator"}`，面板文案也写明"未接入真实 AI"。

| 层 | 实现 |
| --- | --- |
| 配置 | `preferences.json` 的 `chat` 段：`enabled=false`、`mode='follow'`、`maxTokens=256`、`historyTurns=6`、`persona=''`，带范围校验 |
| 路由 | `POST /<token>/chat`（同源 + 8 KiB 请求体上限 + 并发 1 + 单条 500 字）→ SSE |
| 帧 | `meta` → 若干 `delta` → `end{reason}`，失败时 `error{code}`；每 10 秒发 `: keepalive` |
| 取消 | 客户端 `AbortController` → 请求断开 → 服务端 abort 仿真流；服务端 30 秒超时回 `error{code:'timeout'}` |
| 异常 | `empty-stream`（无分片）、`upstream-error`（仿真器抛错）、`chat-disabled`(409)、`chat-busy`(429)、`text-too-long`(400) |
| 浏览器 | `fetch` + `response.body.getReader()` + `TextDecoder(stream)` + 自研 SSE 解析（不用 EventSource，因为它只支持 GET） |
| UI | 面板「对话（模拟）」：启用开关、follow/pet 模式、输入框、发送/停止、状态行；回复复用现有气泡 |
| 隐私 | 正文不写日志、不入 `preferences.json`、不进 telemetry；测试断言 prompt 不出现在任何落盘文件里 |
| 宿主隔离 | 对话功能**不注入 `llm`**，模型服务不存在也不影响动画、装扮、跟随与点击反馈 |

follow 模式的真实接入约束（未来）：用户主动开启才订阅指定会话、不自动读所有会话、不展示推理/工具结果/敏感字段、
正文不落盘、关闭后立即停止订阅。pet 模式未来接入时才用 `sessionController.create/prompt`，并保留完整取消。

### 20.3 测试

`npm test`：**182 / 182 通过**（第五阶段新增 34 项）。

- 存档：迁移内容、幂等、不覆盖、坏档、双档并存、回退重迁（7 项）
- 对话配置：默认值、类型/范围、500 字按码点计数（6 项）
- SSE：编码回读、逐字符切分、CRLF/CR/LF、多行 data、注释、`[DONE]`、无尾空行、UTF-8 跨块（7 项）
- 仿真器：正常、follow、空、抛错、stall、取消、无密钥样式（7 项）
- HTTP：409 未启用、SSE 帧序、follow 不回显、空/超长、413/403、并发 429、正文不落盘、渲染器接线（8 项）
## 21. 第六阶段：模拟对话稳定性修订

本轮只修边界，不接真实模型，也没有新增产品功能。

| # | 问题 | 修复 |
| --- | --- | --- |
| 1 | SSE 解析器在 `\r\n` 被拆到两个网络块时会把 `\r` 当成行结束，提前分帧 | `push()` 遇到末尾单独的 `\r` 先等待下一块；`end()` 时再按行结束处理。新增"每个切点都断开"的参数化测试 |
| 2 | 渲染器把任何 `end` 都当成功，`aborted`/异常结束也会显示"回复完成" | 解析 `end.reason`：`ok` 才算完成，`aborted` 显示"已停止生成"，其他值记为 `生成失败：<reason>`；缺 `end` 仍报"流意外结束" |
| 3 | 页面卸载 / 关闭对话 / 切换模式后，未结束的流和定时器可能残留 | `dispose()` 统一 `chatAbort.abort()` 并清气泡定时器；取消勾选"启用对话"与切换模式都会先 `stopChat()` |
| 4 | 没有真正"挂起"的模拟上游，超时/断连/释放难以验证 | 仿真器新增 `hang` 场景（等待 abort），并通过 `DSH_LIVE2D_CHAT_SCENARIO` 注入；HTTP 测试覆盖超时与客户端断开 |
| 5 | 未来接真实计费模型缺少限流 | 新增每分钟 6 次滑动窗口（`chatHits`），超限回 `429 rate-limited` + `Retry-After`；窗口与条数可用环境变量在测试中缩短，生产默认 6 次/60 秒 |
| 6 | 异常路径下 `chatBusy` 可能锁死 | `chatBusy=true` 之后的所有步骤都在 `try/finally` 内，`release()` 幂等清理定时器、心跳与监听；`send()` 对已断开连接吞掉写入异常。测试覆盖"超时后仍可再次请求"和"客户端断开后仍可再次请求" |

测试：新增 8 项（SSE 2、仿真器 1、HTTP 5），合计 **190 / 190**；GUI 20 项复跑全通过；`check_release` 通过。

遗留风险：

- 限流是进程内滑动窗口，多 profile 并发时各自计数；真实接入时若需全局配额，要换成共享存储或宿主侧配额。
- 超时只覆盖"上游长时间不产出"，不覆盖"上游持续慢速产出"（目前 30 秒总时长会截断，但没有 idle 超时）。
- 取消是"协作式"的：仿真器会立刻响应 abort，真实适配器是否立即停止计费取决于其实现，接入时需再验证。
## 22. 第七阶段：Host ↔ Electron 桥接与模拟适配器

设计稿见 [HOST-BRIDGE.md](HOST-BRIDGE.md)（先于实现单独提交）。本轮只完成桥接与**模拟**适配器，
没有发起任何真实推理请求。

### 22.1 拓扑

```
DSH Host（src/index.js）
  ├─ activity / bridge publisher ──POST──▶ desktop-bridge.json（既有协议，未改）
  └─ host-bridge server 127.0.0.1:<随机端口>
        ▲ Authorization: Bearer <每次启动随机的 token>
        │ 文件：<configDir>/host-bridge.json（退出即删）
        │
Electron（desktop/main.mjs + src/viewer-server.js）
  └─ /chat（同源 + token 路径）→ 若 chat.backend=host 则转发 Host，失败降级本地模拟
        ▲
渲染器（fetch + ReadableStream）
```

### 22.2 关键约定

| 项 | 实现 |
| --- | --- |
| 绑定 | 只用 `127.0.0.1` + 临时端口；不监听 `0.0.0.0` |
| 认证 | `randomBytes(32)` 每次启动重新生成；只写在 `host-bridge.json`，不进日志、不进渲染器 |
| 兼容 | `desktop-bridge.json` 字段与语义完全不变；新增能力全部走新文件与新路由 |
| 限额 | 8 KiB 请求体、500 字、并发 1、每分钟 6 次、30 秒超时，全部在 Host 与 Electron 两侧各自强制 |
| 降级 | Host 缺失 → `meta{degraded:true}` + 本地模拟；Host 中途退出 → `error{host-lost}`，UI 明确提示 |
| 清理 | 插件卸载关闭 server、删文件、释放监听与定时器；Electron 关闭时取消在途请求 |
| 非强制依赖 | `inject` 仍只有 `webServer`、`credentials`；桥接启动失败仅记日志 |

### 22.3 修改文件

| 文件 | 说明 |
| --- | --- |
| `docs/HOST-BRIDGE.md` | 协议设计（先提交） |
| `src/features/chat/stream.mjs` | 统一 SSE 写出：meta→delta→end/error、超时、心跳、取消、降级标记 |
| `src/features/chat/host-adapter.mjs` | 模型解析（agentDefaultModel → listProviders/listModels）、StreamChunk 映射、具名错误、真实调用准入 |
| `src/features/chat/host-bridge.mjs` | Host 侧 HTTP server：认证、来源、限额、限流、并发、桥接文件生命周期 |
| `src/features/chat/config.mjs` | 新增 `backend: 'simulated' \| 'host'`（默认 simulated） |
| `src/index.js` | 启动/关闭桥接；失败不影响其它功能 |
| `src/viewer-server.js` | backend=host 时转发；失败降级；统一使用 stream 模块 |
| `renderer/viewer.js` | 展示后端（本地模拟 / DSH 模型）与降级提示 |
| 测试 | `host-adapter` 7 项、`host-bridge` 9 项、`host-chat-proxy` 6 项、`host-plugin` 3 项 |

### 22.4 测试

`npm test`：**216 / 216 通过**（第七阶段新增 25 项）。覆盖：桥接认证成功/失败、正常 SSE、
跨块解析（沿用）、Host 不在线降级、Host 中途退出、取消、超时/空流/错误、并发与限流、
卸载清理、模型服务缺失仍可启动、follow/pet 隔离、正文与令牌不入日志。
GUI 20 项复跑通过；`check_release` 通过（117 个已跟踪文件）。

### 22.5 首次启用真实 LLM 还需要什么

1. **人工审批**：明确同意"桌宠对话会消耗模型额度"。
2. **开关置位**：`chat.backend='host'` + `DSH_LIVE2D_CHAT_REAL=1`，两者缺一不可。
3. **模型解析验证**：在真实 Host 上确认 `agentDefaultModel` 能给出 provider/model，且 `llm.stream` 可用。
4. **费用控制复核**：6 次/分钟、并发 1、30 秒超时、无自动重试；先做一笔最小调用观察计费。
5. **错误面复核**：AUTH / RATE_LIMIT / NO_ADAPTER / 取消 的真实错误码与文案。
6. **隐私复核**：确认真实适配器不会把正文写进 DSH 日志；本插件侧已保证不落盘。
7. **回退演练**：`DSH_LIVE2D_CHAT_REAL` 关闭后应立刻回到模拟；`host-bridge.json` 删除等效于 Host 离线。

### 22.6 遗留风险

- follow 模式目前仍是模拟消息，真实会话订阅与"用户显式选择会话"未实现。
- 桥接令牌在文件中，依赖用户目录权限；多用户机器需额外评估。
- Electron 与 Host 的限流各自计数，极端并发下总配额可能翻倍。
- 真实适配器的取消是否立即停止计费，取决于其实现，接入时必须实测。
## 23. 第七阶段第二部分：真实调用前的安全修订

本轮仍**没有**真实推理；只修准入、结束语义、日志与权限。

### 23.1 准入：五条件，且不信请求正文

`src/features/chat/authorization.mjs` 在 Host 侧独立判定，读取用户保存的配置
（`preferences.desktop.json` 优先，其次 `preferences.json`）：

| 条件 | 不满足时 |
| --- | --- |
| `chat.backend === 'host'` | `backend-not-host` |
| `chat.realConsent === true`（用户勾选"允许真实模型调用"） | `no-user-consent` |
| `chat.mode === 'pet'` | `mode-not-pet` |
| 环境变量 `DSH_LIVE2D_CHAT_REAL=1` | `env-disabled` |
| Host 能解析出模型且 `llm.stream` 存在 | `model-unavailable` / `llm-unavailable` |

**请求正文里的 `backend`/`mode` 不再参与授权**：直接请求桥接也无法绕过开关。
不满足时一律走本地模拟，并在 meta 帧标注 `simulated:true` 与原因码（不写正文）。

### 23.2 结束语义

`streamHostChat()` 现在保证**恰好一个**终止帧：`finish{ok}` / `finish{aborted}` / `finish{error,code}`：

- 有文本后 `aborted` → 输出 `end{reason:'aborted'}`，**绝不显示为成功**；
- `error` → 透传稳定错误码（未知码归一为 `UPSTREAM_ERROR`）；
- 迭代器结束但缺 `finish` → `NO_FINISH`；未知 `finish.kind` → `UNKNOWN_FINISH`；
- 自定义 produce 缺终止帧时，`writeChatStream` 输出 `error{no-finish}`；
- 取消后不再等待不响应取消的上游：`nextOrAbort` 立即返回，`iterator.return` 最多等 200 ms；
- 模拟器路径无终止帧，按其正常走完视为 `ok`（`end{simulated:true}`）。

### 23.3 日志与凭据

- 新增 `safeCode()`：只放行 `/^[A-Z][A-Z0-9_]{1,39}$/` 形状的错误码；原始 `error.message`、正文、回复、
  令牌一律不写日志。Host 桥接日志只包含 `backend=`、`reason=<码>`、`acl=<受限|尽力>`、`code=<码>`。
- Windows 下写 `host-bridge.json` 后执行 `icacls /inheritance:r /grant:r <用户>:F`；实测输出只有
  `PC-…\Administrator:(F)`，无 `Everyone` / `BUILTIN\Users`；非 Windows 用 `chmod 0o600`。
- 令牌每次启动重新生成；`close()` 删除桥接文件，旧令牌立即失效。

### 23.4 DSH 接口核对（离线）

| 项 | 结论 | 依据 |
| --- | --- | --- |
| `ctx.get('llm')` | Cordis 容器取值，服务缺失返回 undefined；插件不再把 llm 写进 `inject` | `src/index.js` + 假 llm 注入测试 |
| `agentDefaultModel` | `get()` 同步 / `resolve()` 异步两种都支持，失败退回 `listProviders/listModels` | `host-adapter` 7 项测试 |
| `finish.reason.kind` | 合法值 `ok` / `aborted` / `error`；其它值按 `UNKNOWN_FINISH` 失败处理 | 映射测试 |
| 模型不可用 | 降级模拟，不抛错、不影响动画 | `model-unavailable` 测试 |
| 热重载/移除文件 | 下一次请求重新读 `host-bridge.json`，缺失即降级 | 代理测试 |
| 卸载清理 | 关闭 server、abort 在途流、删文件、清定时器 | `close()` 测试 + 插件源码断言 |

### 23.5 测试与验收

`npm test`：**238 / 238 通过**（本轮新增 22 项：准入 4、结束语义 9、桥接绕过/日志 5、其他适配）。
`check_release` 通过（124 个已跟踪文件）；GUI 20 项复跑通过；ACL 手工核验通过。

### 23.6 真实模型首次调用的最终准入检查表

- [ ] 用户勾选「允许真实模型调用（可能产生费用）」并保存（`realConsent: true`）
- [ ] `chat.backend = 'host'` 且 `chat.mode = 'pet'`
- [ ] Host 环境变量 `DSH_LIVE2D_CHAT_REAL=1`
- [ ] `agentDefaultModel` 解析成功、`llm.stream` 可调用（真实 Host 上验证）
- [ ] GUI 状态行显示「DSH 模型」，且不是「已降级」
- [ ] 首笔调用后核对额度消耗与取消行为
- [ ] 关闭 `DSH_LIVE2D_CHAT_REAL` 或删除 `host-bridge.json` 能立即回到模拟
- [ ] 确认 DSH 侧日志不含正文与密钥
## 24. 第七阶段最终安全补丁（真实调用前）

### 24.1 准入六条件（新增 enabled、ACL、Desktop-only）

`authorizeRealChat()` 现在要求全部满足，否则一律模拟：

| 条件 | 失败原因码 |
| --- | --- |
| `chat.enabled === true` | `chat-disabled` |
| Desktop 存档 `backend === 'host'` | `backend-not-host` |
| `chat.realConsent === true` | `no-user-consent` |
| `chat.mode === 'pet'` | `mode-not-pet` |
| `DSH_LIVE2D_CHAT_REAL=1` | `env-disabled` |
| 桥接文件 ACL 收紧成功 | `acl-unavailable` |
| 模型可解析且 `llm.stream` 存在 | `model-unavailable` / `llm-unavailable` |

**只读 `preferences.desktop.json`**：overlay 存档不再参与真实授权（浮层阶段的"模糊授权"已被移除）；
overlay 仍可正常聊天，但永远走模拟。请求正文的 `backend`/`mode` 依旧不参与授权。

### 24.2 错误与日志

- 桥接外层 catch 原先会记录 `error.message`，已改为 `safeCode(error)`（白名单 `^[A-Z][A-Z0-9_]{1,39}$`）；
- `finish.error.code` 与所有 SSE 错误码统一走 `safeCode`，恶意码（空格/正文/密钥样式）归一为 `UPSTREAM_ERROR`；
- 内层 catch 先写 500 再进 finally，避免"异常时用默认 200 结束空响应"；
- 测试用运行时拼接的假密钥与含密钥正文，断言 SSE 与日志均不泄漏。

### 24.3 异常路径与 ACL

- 授权、模型解析、请求执行全部在 `try/catch/finally` 内：异常也会释放 `busy`、`AbortController`、监听器；
  实测"授权抛错 → 500 → 下一次请求正常"；
- ACL 改为**先对临时文件收紧、再 rename**；`icacls` 失败时 `aclRestricted=false`，
  日志写 `acl=unavailable` 且真实后端被禁止（只影响真实调用，不影响模拟）。

### 24.4 测试

`npm test`：**245 / 245 通过**（本轮 +7：enabled 拒绝、Desktop/Overlay 冲突、ACL 拒绝、
授权抛错恢复、恶意错误码/密钥不泄漏、finish 码归一）。
`check_release` 通过（127 个文件）；GUI 20 项复跑通过。

### 24.5 准入检查表（更新）

- [ ] `chat.enabled = true`、`backend = 'host'`、`realConsent = true`、`mode = 'pet'`
- [ ] 配置写在 **Desktop 存档**（`preferences.desktop.json`），不是 overlay 存档
- [ ] Host 环境 `DSH_LIVE2D_CHAT_REAL=1`
- [ ] `host-bridge.json` 的 ACL 收紧成功（日志 `acl=restricted`，不是 `unavailable`）
- [ ] 真实 Host 上模型可解析、`llm.stream` 可用
- [ ] GUI 显示「DSH 模型」而非「已降级」
- [ ] 首笔调用后核对额度与取消行为；关闭开关立即回到模拟
## 25. 第七阶段第三部分：真实 Follow（只读陪伴）

### 25.1 接口核对（离线，基于本机 DSH 0.2.1-rc.5 的类型定义与官方文档）

| 能力 | 结论 | 使用方式 |
| --- | --- | --- |
| 列出会话 | `sessionController.list(request, signal)` 返回可见会话摘要 | 只调用该方法，不读会话数据库 |
| 订阅事件 | `session/event(this: Scoped<Session>, session, event)` 是 post-commit、按 agent scope 过滤的事件 | `ctx.on('session/event', (session, event) => …)`，只处理 `session.id === 已选会话` |
| 最终回复结构 | `assistant/message.data.message.content` 是块数组；只取 `type === 'text'` | 推理 / tool-call / tool-result 块一律丢掉 |
| 运行状态 | `api-session/status(sessionId, running)` | 映射成 `running` / `idle` 两态 |
| 会话 id 关联 | `session/event` 的第一个参数就是 Session 对象，`session.id` 可靠 | 不依赖 agent id 反推 session |
| 历史回放 | 默认**不**回放，只接收订阅之后的新事件 | 订阅建立后才开始转发 |

**未在真实 DSH 会话上实测**（本机 Electron 测试环境没有运行中的 DSH Host），本轮用官方接口 + Fake Session 验证；
真实接入前需在运行中的 DSH 上做一次手工确认（见 25.6）。

### 25.2 工作流程

```
设置面板：启用 Follow + 手动选择会话（保存在 preferences.desktop.json 的 follow 段）
  → 渲染器 POST /follow/sessions（viewer 同源）
      → viewer 转发 Host /follow/sessions（Bearer 令牌，127.0.0.1）
          → Host 调 sessionController.list() 返回 {id,title}（标题截断 60 字）
  → 渲染器 POST /follow {sessionId}
      → Host 校验 follow.enabled && follow.sessionId === 请求值（不信任正文其它字段）
      → 订阅 session/event 与 api-session/status，只转发该 session 的 assistant/message 文本块
      → SSE 帧：follow-ready / follow-status / follow-message{text,truncated,seq}
  → 渲染器：seq 去重、160 字截断、textContent 写入气泡
  → 关闭 Follow / 切换模式 / 退出：abort 请求 → Host 收到 close 立即退订
```

### 25.3 隐私边界

- 只展示所选会话的 `assistant/message` 中 `type:'text'` 的块；推理、工具调用/结果、系统提示词、Shell 日志一律丢弃；
- 不自动回放历史，只收订阅之后的新事件；
- 气泡用 `textContent`，不解释 HTML；
- 界面常驻隐私提示 + 「隐藏内容」按钮（一键清空气泡，不停止跟随）；
- 不依赖敏感词正则承诺"绝对防泄漏"——最终回复本身仍可能含敏感信息，界面明确提示；
- 日志只记录帧类型与错误码，不记录正文、会话标题或令牌。

### 25.4 与 Pet / 收费链路隔离

- Follow 有独立的 `followBusy` 并发位，不占用 Pet 的每分钟 6 次配额；
- Follow 只读，不调用 `llm.stream`、不向开发会话发送 prompt、不触发任何工具；
- Pet 对话进行中（`chatAbort` 活跃）时，Follow 消息不覆盖气泡；
- 桥接关闭时同时 abort 全部 Follow 流并退订。

### 25.5 测试

`npm test`：**264 / 264 通过**（本轮 +19）：Follow 纯逻辑 7、Host 流 9、Electron 代理与接线 3。
覆盖：未选择会话禁止订阅、会话不匹配拒绝、A/B 会话隔离、推理/工具结果不展示、最终回复展示、
重复 seq 去重、关闭/断线退订、Host 离线降级、Follow 不调用 llm.stream、日志无正文/标题/令牌、
Follow 与 Pet 并存、插件卸载清理。

GUI：22 项通过（新增"跟随控件默认关闭""无 Host 时明确降级"）。

### 25.6 未解决风险

1. **真实 DSH 会话未实测**：`sessionController.list()` 与 `session/event` 的行为按 0.2.1-rc.5 接口实现，
   但本机测试环境没有运行中的 DSH Host，需在真实 DSH 上手工验证一次（选择会话→收到回复→关闭退订）。
2. 会话标题可能包含敏感信息：选择器显示标题（截断 60 字），属于用户可见范围，仍需用户自行判断。
3. `session/event` 按 agent scope 过滤：若未来 DSH 改变 scope 语义，需重新确认不会收到未授权会话。
4. Follow 只展示"最终回复"，不是实时 token 流（真实接口如此），文档与 UI 不应宣称实时逐字。
5. 桥接令牌仍在 `host-bridge.json`，Follow 与 Pet 共用同一条认证通道。
## 26. 第七阶段第四部分：Follow 稳定化与真实宿主验收

### 26.1 长连接修复

| 问题 | 修复 |
| --- | --- |
| Follow 走 Pet 的 60 s 总超时 | Follow 转发改为**只有空闲阈值**（默认 45 s，`DSH_LIVE2D_FOLLOW_IDLE_MS` 可覆盖），每收到一块数据就重置；Host 每 10 s 的 keepalive 足以维持 |
| 断线无恢复 | 渲染器按 1/2/4/8/15 s 退避最多重连 5 次；提示"第 N 次重连" |
| 用户停止后被自动拉起 | `followUserStopped` 标记 + 代际递增，停止后任何旧请求/定时器都作废 |
| 切换会话残留旧订阅 | 每次启动 `++followGeneration` 并 abort 旧请求，旧回调按代际丢弃 |
| Host 卸载残留 | 桥接 `close()` abort 全部 Follow 控制器；插件 effect 里 `sessionSource.dispose()` + `hostBridge.close()` |

### 26.2 配置保存竞态

- `persist()` 现在返回布尔成功态；
- 启用 / 切换会话时**先 `await applyFollow(...)`**，保存失败直接提示"未启动跟随"，不请求 Host；
- 保存后校验 `follow.sessionId === 下拉框当前值`，快速连续切换只有最新一次生效；
- Host 侧仍以 Desktop 存档里的 `sessionId` 为准（请求正文不授予身份）。

### 26.3 隐私体验

- 新增「持续隐藏新内容」：开启后新回复只更新状态文字，不弹气泡；与「隐藏当前内容」区分；
- 全部文本仍用 `textContent`；默认不回放历史；正文不落盘、不进日志。

### 26.4 真实 DSH 宿主验收报告（**部分阻塞**）

环境事实：

- 本机 DSH 0.2.1-rc.5 正在运行（多个 `DeepSeek Harness` 进程），桌宠窗口也在运行；
- `desktop` Profile 里安装的是 **0.7.3 的发布 tgz**（`file:...live2d-pack\dsh-deepseek-live2d-0.7.3.tgz`），不是本轮工作树；
- `dsh --profile desktop --dump-config` 返回：`error: profile "desktop" is managed exclusively by the Electron application`。

| 验收项 | 结果 |
| --- | --- |
| 1. 从真实 DSH 列出可见会话 | ⛔ **阻塞**：插件必须运行在 Host 内才能调用 `sessionController.list()`；本轮工作树未安装进运行中的 Profile，且该 Profile 只能由 Electron 应用管理 |
| 2. 选中会话后订阅 | ⛔ 阻塞（同上，依赖 1） |
| 3. 新助手回复显示在气泡 | ⛔ 阻塞：既需要 1/2，也需要真实会话产生新回复 |
| 4. 会话正文隔离 | ✅ 离线验证（Fake Session A/B 用例），真机未验证 |
| 5. 超过 2 分钟连接保持 | ⚠️ 离线验证了"无总超时 + 空闲阈值"；真机长连接未跑（需 1/2） |
| 6. 停止/切换/退出退订 | ✅ 离线验证（客户端断开 → Host 退订、代际作废） |
| 7. 推理与工具结果不进气泡 | ✅ 离线验证（块类型过滤用例） |
| 8. Pet 对话时 Follow 不抢气泡 | ✅ 离线验证（`chatAbort` 分支） |
| 9. Host 退出/重启降级与恢复 | ✅ 离线验证（503 降级、重连退避）；真机未验证 |
| 10. Follow 不产生额外 LLM 调用 | ✅ 代码路径断言 + 测试（Follow 不触碰 `llm.stream`） |

**为什么没有强行真机验收**：把开发中的工作树装进唯一的 `desktop` Profile 会覆盖正在稳定运行的 0.7.3、需要重启 DSH，
并且要产生真实助手回复就得发起一次真实 LLM 调用——三者都违反本轮约束。离线 Fake Session 结果**不作为**实机验收。

**下一次真机验收的前置**：新建一个隔离 profile（或临时 `DSH_HOME`），装入本工作树，启动第二个实例，
在正常开发任务里自然产生回复（不额外发 Prompt），然后按 26.5 逐项核对。

### 26.5 手工验收步骤（待真机执行）

1. 隔离 profile 启动 DSH，打开桌宠设置 → 勾选「启用跟随」；
2. 确认下拉框列出真实会话，且默认未选中任何项；
3. 选中一个会话 → 状态显示"正在跟随所选会话（只读）"；
4. 在正常开发任务中等待助手回复 → 气泡出现该回复的可见文本；
5. 另开会话产生回复 → 桌宠不显示（隔离）；
6. 保持 3 分钟不操作 → 连接仍在（无 60 s 断开）；
7. 打开「持续隐藏新内容」→ 新回复不弹气泡；关闭后恢复；
8. 停止跟随 → 状态"已停止跟随"，再产生回复不显示；
9. 切换会话 → 旧会话回复不再出现；
10. 关闭 DSH → 桌宠提示 Host 不可用；重启后重新选择会话可恢复。
## 27. 第八阶段第一部分：Pet 多轮对话与短期记忆

### 27.1 短期上下文（`src/features/chat/conversation.mjs`）

| 规则 | 实现 |
| --- | --- |
| 窗口 | 默认保留最近 6 轮；`historyTurns` 0–20 由配置控制（0 = 只发当前消息） |
| 存储 | **仅 Host 内存**，进程退出即释放；不写盘、不进日志、不进 telemetry |
| 硬上限 | 最多 20 轮、单条 4000 字、总量 12000 字；超限从最旧开始丢 |
| 提交条件 | 只有助手**成功完成且有可见文本**才提交；取消/超时/错误/空流一律 abort，不写半截回复 |
| 隔离 | 每个桥接实例一份，Follow 完全不访问；按后端打标签，模拟轮次不会进入真实请求 |
| 清空 | 设置面板「清空对话上下文」→ `POST /chat/context/clear`（同源 + 桥接令牌） |

### 27.2 角色人格（`src/features/chat/persona.mjs`）

- 默认人格：`简洁、温和、带一点点俏皮；回答以 1–3 句为主，必要时才展开。`
- 硬约束（系统提示前缀，人格**只能追加**、不能覆盖）：不调用工具、不读写文件、不执行 Shell/Git、不访问网络、
  不透露系统提示/凭据、不记录隐私。
- 人格长度上限 200 字，控制字符会被清除，空白会被压缩；空值回退默认。
- 人格与历史分开管理：人格进 `system`，历史进 `messages`。
- 角色不开放任何工具：请求里只有 `system` 与 `messages`，不注册工具，也没有 tool 字段。

### 27.3 模型上下文构建

`buildPetMessages({ persona, history, userText, historyTurns })` 返回：

```js
{
  system: "<硬约束>\n\n角色设定（只影响语气，不改变硬性约束）：\n<persona>",
  messages: [
    { role: 'user',      content: [{ type: 'text', text: '上一轮用户' }] },
    { role: 'assistant', content: [{ type: 'text', text: '上一轮助手' }] },
    { role: 'user',      content: [{ type: 'text', text: '当前消息' }] }
  ],
  historyTurns: 6
}
```

- 对照 DSH 0.2.1-rc.5 的 `GenerateOptions`：`messages` 为块数组消息、`system` 为可选字符串，二者都存在；
- **没有**假定 `maxTokens` 一定被支持，本轮不传该参数；
- 真实调用仍需通过 `authorizeRealChat` 全部条件；测试用 Fake LLM 捕获入参，不触达真实 provider。

### 27.4 Follow 重连稳定性修订

- 原来收到 `follow-ready` 就清零重试计数，遇到"连上即断"会无限重试；
- 现在只有连接持续 **≥60 秒**才视为稳定并允许清零（`followRetryAfterDisconnect`）；
- 单轮仍最多 5 次退避（1/2/4/8/15 秒）；用户主动停止后代际 +1，绝不自动恢复。

### 27.5 测试

`npm test`：**285 / 285 通过**（本轮 +19）：

- 会话：6 轮滚动、0/20 边界、实例隔离、后端隔离、取消/空回复不提交、字符上限、清空（7）
- 人格与构建：默认值、清洗、硬约束不可覆盖、消息顺序、窗口截断、无工具字段（6）
- Host 集成（Fake LLM）：第二轮入参包含第一轮、失败/取消不写入、清空后只发当前消息、模拟轮次不污染真实历史（5）
- Follow 重连：稳定 60 秒才清零、短连接累加、上限放弃（1）

GUI：24 项通过（新增角色描述控件与清空按钮检查）。`check_release` 通过。

### 27.6 遗留风险

1. **真实适配器未验证**：`system` 与块数组消息在真实 provider 上的接受度需接入时确认（Fake 只验证契约形状）。
2. 记忆是进程内、按桥接实例；DSH 重启后清空（符合本轮要求，但用户需知情）。
3. 人格是提示层约束，不是安全边界；模型仍可能不遵守，不能替代权限控制。
4. 模拟轮次刻意不进入真实历史，切换后端后上下文会"重新开始"，需在 UI 说明。
5. 真实 DSH 会话验收（第七阶段遗留）仍未完成。