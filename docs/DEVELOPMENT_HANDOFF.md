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
| ⏳ 待授权 | AI 对话（先做只读 Probe）、TTS（需选型与模型体积评估） |
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

## 17. 待人工验收

1. **P2 方案 C 的观感确认**：关闭双击后快速连点，应只出现一次点头/一次气泡；头部开关关闭时连点头部应毫无反应；
   双击开关开启时行为与之前完全一致。
2. **Windows 独立窗口实际观感**：本轮只做到真实 HTTP 层验证，未启动 Electron 窗口（仓库不含模型与 Core，
   本机唯一模型属于另一台设备的隔离目录，启动会额外弹一个透明窗口）。验收步骤见 §12.5，重点看：
   关闭各开关后的反应、冷却手感、气泡文案替换、恢复默认、**重启 DSH 后设置是否保留**、
   以及把气泡填到 12 条 × 40 字后点保存，是否出现「设置已保存」且重启不丢。
3. **合并前检查**：`npm test` 141 项全绿 + `check_release` 103 文件通过 + 用户视觉验收记录。


