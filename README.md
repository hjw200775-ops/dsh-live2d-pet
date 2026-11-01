# DSH DeepSeek-chan Live2D

DSH（DeepSeek Harness）的 Live2D 桌宠：跟随助手运行状态切换动作与表情。**默认是独立透明桌面窗口**——装完插件重开 DSH，桌宠会自己出现在桌面上，页面里不会再叠浮层。代码 MIT 开源。

> **装完基本不用再折腾**：模型包（约 48 MB）和 Electron 运行时（约 100 MB）都在首次启动时自动下载并校验，只需一次。
> 唯一要手动的是 **Live2D Cubism Core**：它属 Live2D 专有许可，不能随包分发，请从 [Live2D 官网](https://www.live2d.com/en/sdk/download/web/) 下载 `live2dcubismcore.min.js` 放到 `~/.dsh/live2d/`。
> 模型 **DeepSeek-chan** 由 [Kamiya Ryoko](https://vgen.co/KAMIYA)（神宫凉子）绘制并免费发布、霓虹猫_NeonNeko 绑定，本仓库已在作者许可下把模型放进 GitHub Release 附件。

## 状态表现

| DSH 状态 | 桌宠表现 |
|---|---|
| 待机 | Idle，清除临时表情 |
| 思考 / 工具步骤 | Idle + 加载表情 |
| 回答正文 | 抬手强调动作 + 脸红表情 + 示意性嘴部动作 |
| 错误 | 流冷汗；必要时收手，保留约 6 秒后回到当前活动状态 |

状态来自宿主的 `agent/status`、`agent/assistant-stream`、`agent/error`，不抓聊天 DOM、不猜输出文字。
多回合并行时按「错误 > 正在回答 > 正在思考 > 待机」聚合。嘴部是示意动画，不是音频口型同步。

## 安装

### 0. 先找到 `dsh` 命令

Windows 上 `dsh` **通常不在 PATH 里**，直接敲会提示"无法识别"。它就在 DSH 安装目录下：

```powershell
# 假设 DSH 装在 F:\dsh1（换成你自己的安装目录）
$dsh = "F:\dsh1\resources\runtime\cli\bin\dsh.cmd"
& $dsh plugin --profile desktop add dsh-deepseek-live2d@0.6.10
```

不想用命令行的话，直接在 DSH 的 **设置 → 插件** 里装也行，效果一样。

### 1. 装插件

```powershell
# 推荐：指定版本，避免刚发布时缓存滞后装到旧版
& $dsh plugin --profile desktop add dsh-deepseek-live2d@0.6.10

# 或从 Release 里的 tgz
& $dsh plugin --profile desktop add '<绝对路径>\dsh-deepseek-live2d-0.6.10.tgz'

# 或直接从 GitHub 源码装
& $dsh plugin --profile desktop add github:hjw200775-ops/dsh-live2d-pet-
```

**0.6.9 起（当前 0.6.10）安装是干净的：** 依赖里不再有 `electron`，也没有 `postinstall`，所以不会出现
`Ignored build scripts`，命令正常返回 0，插件管理器才会把这一层挂进 `dsh.profile.bundles`。

> 0.6.8 及更早会返回退出码 1，于是出现"包装了、层没挂上、桌宠永远不出现"的问题——必须手改 bundles 才行。
> 如果你踩过这个坑，`~/.dsh/profiles/desktop/pnpm-workspace.yaml` 里可能被写进了
> `onlyBuiltDependencies: electron: "set this to true or false"` 这类占位符。0.6.9 不需要任何构建审批，
> 把整个 `onlyBuiltDependencies` 段删掉即可。

### 2. 放 Core（唯一需要手动的一步）

从 [Live2D 官网](https://www.live2d.com/en/sdk/download/web/) 下载 Cubism Core，把 `live2dcubismcore.min.js` 放到：

```
~/.dsh/live2d/live2dcubismcore.min.js
```

这一步没法自动化：Core 有独立授权，既不能随包分发，也不适合让插件替用户接受协议。
**没放也不影响启动**：桌面窗口会照常出现，并在窗口正中显示一张大字卡片，写清缺什么、去哪下载。

手里已经有 Core（比如别的插件带的、或之前下过）就不用重下，直接导入：

```powershell
npx dsh-live2d-import-core "C:\下载\live2dcubismcore.min.js"
# 也可以给包含它的目录
npx dsh-live2d-import-core "C:\下载\core解压目录"
```

它会先检查文件大小和特征字符串（防止把浏览器下到的 404 页面当成 Core），再复制到约定目录，
旧的会自动备份成 `.bak-时间戳`。

### 3. 重新打开 DSH

**应用 → 退出**（别只关窗口、别只刷新），再启动。首次启动时插件会依次：

1. 自动下载模型包（约 48 MB，校验 sha256 后解压到 `~/.dsh/live2d`）；
2. 自动下载 Electron 运行时（约 100 MB，解压到 `~/.dsh/live2d/electron/v33.4.11`，多个 profile 共用一份）；
3. 拉起独立透明桌面窗口。

两个下载都只做一次，之后每次启动都是秒开；进度会打在 DSH 控制台里（`[live2d] …`）。

想提前准备好、或者下载失败要重试，跑一条命令即可（不用重启 DSH）：

```powershell
# 在 desktop profile 目录里执行，npx 才会用到已安装的那份插件
cd "$env:USERPROFILE\.dsh\profiles\desktop"
npx dsh-live2d-setup
```

在别的目录里执行也没关系：脚本发现自己跑在 npx 的临时副本里时，会自动回到
`~/.dsh/profiles/*` 找真正装好的那份再补。也可以直接指定：

```powershell
npx dsh-live2d-setup --plugin "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-deepseek-live2d"
```

### 3.1 Electron 下载慢或失败（国内网络）

Electron 的二进制由插件自己下载，**并且会自动切换镜像，通常不用管**：先试 GitHub，
卡住 20 秒不动或报错就自动换 `npmmirror`，下载完做 sha256 校验。
（实测国内 GitHub 直连经常直接失败，镜像约 25 秒下完；插件内默认顺序就是 GitHub → npmmirror。）

想强制指定某个源（例如公司内网镜像），再设环境变量：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"

cd "$env:USERPROFILE\.dsh\profiles\desktop"
npx dsh-live2d-setup
```

模型包（48 MB）走的是 `api.github.com`，脚本自带直链回退；如果两条都不通，可以手动从
[Releases](https://github.com/hjw200775-ops/dsh-live2d-pet-/releases) 下载模型 zip，解压到
`~/.dsh/live2d`（应得到 `~/.dsh/live2d/DeepSeek-chan/大肥鱼.model3.json`）。

### 3.2 出问题了：先跑自检

```powershell
npx dsh-live2d-doctor
```

一次查完：插件版本、配置文件、模型文件（纹理/动作/表情数量）、Core 是否真的是 Core、
Electron 运行时、桌面窗口是否在跑。有问题的地方会标 ✖ 并写明下一步怎么做，
最后附一段「复制给作者」的摘要——报问题直接粘这段，比描述“它就是不出现”有用一百倍。

日志也和以前不一样了：**现在会落盘**到 `~/.dsh/live2d/logs/`（按天分文件，保留最近 5 份）。
桌面窗口的托盘右键菜单里有「打开日志目录」，出问题一键打开就能把文件发出来。

### 4. 可选配置

默认配置已经写在包里（`cordis.patch.yml`）：独立桌面窗口 + 首次自动下载。要覆盖就在 desktop profile 的 `cordis.patch.yml` 里改：

```yaml
- id: deepseek-live2d
  config:
    overlay: true         # 改成页面内浮层（带「移动 / 收起」按钮）
    autoFetchModel: false # 关掉首次自动下载，改由 dsh-live2d-setup 手动触发
```

也可以写 `~/.dsh/live2d/config.json` 指向自己的模型与 Core（**可选**：没有这个文件时，
桌面窗口会按约定路径 `~/.dsh/live2d` 自动找，0.6.8 及更早缺这个文件会直接起不来）：

```json
{
  "modelFile": "D:\\models\\DeepSeek-chan\\大肥鱼.model3.json",
  "coreFile": "D:\\live2d\\live2dcubismcore.min.js",
  "overlay": false
}
```

### 5. 独立桌面窗口（默认模式）

这就是默认模式：DSH 启动时由插件自动拉起，透明、无边框、置顶、不占任务栏。
拖动可以搬位置，右键出侧边设置（装扮、置顶、随 DSH 退出），托盘图标也能管理。

只想手动开一次（不跟着 DSH 自动启动）：

```powershell
npx dsh-live2d-desktop
```

它读取同一份 `~/.dsh/live2d/config.json`。窗口有单实例锁，重复执行只会把已有那只叫到前面，
不会同时出现两只。


## 模型与许可

- 模型署名（请在任何公开场合保留）：
  - Illustration & PSD Layer Separation / Model Release：**Kamiya Ryoko（神宫凉子）**
  - Live2D Rigging：**霓虹猫_NeonNeko**
- 本仓库的 GitHub Release 附件包含该模型，**已获得著作权人许可**（2026-10-31，记录见
  [docs/permission.md](docs/permission.md)），仅限本仓库发布使用；不构成对模型的再授权。
- 使用者**不得转售**模型、不得把模型再次上传到其他平台供他人下载；商业用途请按原作者条款联系作者。
- 模型原始 `Terms of Use` 随压缩包提供，以其为准。
- **Live2D Cubism Core 不随本仓库分发**，其使用遵循 Live2D 的许可协议。
- PSD 源文件不在发布包内。

## 开发

```bash
npm ci --ignore-scripts
node --test test/*.test.mjs     # 30 个测试
node scripts/preview.mjs <config.json>
node scripts/check_release.mjs  # 发布前检查：不得混入模型 / Core / 本机路径 / 密钥
```

## 已知限制

- 浮层在 DSH 内，不能拖出窗口；透明区域仍接收鼠标，没有逐像素点击穿透。
- 未实现语音、音频口型、多角色切换。
- 其他模型若缺少对应动作/表情，需要自行映射；不保证套用本模型的动作名即可运行。
- 5 张 4096 纹理占用显存，兼容性结论仅覆盖作者本机测试组合。

## 停用与卸载

插件页关闭 `dsh-deepseek-live2d` 即可停用；卸载：

```powershell
dsh plugin --profile desktop remove dsh-deepseek-live2d
```

再移除 `cordis.patch.yml` 里的覆盖项。私有模型、Core 与 `preferences.json` 不会被卸载。

## 致谢

- DeepSeek-chan 模型：Kamiya Ryoko（神宫凉子）、霓虹猫_NeonNeko
- [PixiJS](https://github.com/pixijs/pixijs)、[pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)
- 许可细节见 [docs/THIRD-PARTY.md](docs/THIRD-PARTY.md)
