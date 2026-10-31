# DSH DeepSeek-chan Live2D

DSH（DeepSeek Harness）的 Live2D 桌宠浮层：跟随助手运行状态切换动作与表情，透明背景、可拖动缩放、可保存位置。代码 MIT 开源。

> **模型与 Core 都不在本 npm 包里**：
> 模型 **DeepSeek-chan** 由 [Kamiya Ryoko](https://vgen.co/KAMIYA)（神宫凉子）绘制并免费发布、霓虹猫_NeonNeko 绑定，本仓库已在作者许可下把模型放进 GitHub Release 附件；
> Live2D **Cubism Core** 属 Live2D 专有许可，请自行从 Live2D 官网获取。

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

### 1. 安装插件

```powershell
# 从 npm
dsh plugin --profile desktop add dsh-deepseek-live2d

# 或者从 Release 里的 tgz
dsh plugin --profile desktop add '<绝对路径>\dsh-deepseek-live2d-0.6.2.tgz'
```

### 2. 准备模型与 Core（一次就够）

**方式 A（推荐）：一条命令下载模型**，自动校验 sha256 并解压到 `~/.dsh/live2d`：

```powershell
npx dsh-live2d-fetch-model
```

**方式 B：手动下载**——从 [GitHub Releases](../../releases) 下载
`DeepSeek-chan_model_for_dsh-live2d-pet_v1.zip`，解压到 `~/.dsh/live2d`
（解压后应得到 `~/.dsh/live2d/DeepSeek-chan/大肥鱼.model3.json`）。

然后从 Live2D 官网下载 `live2dcubismcore.min.js`，放到：

```
~/.dsh/live2d/live2dcubismcore.min.js
```

### 3. 启动

**重新启动 DSH 即可，不用写任何配置文件。** 插件会自动按约定路径找模型与 Core，
桌宠会以浮层形式出现在右下角。

### 4. 可选配置（只有需要改路径/关闭浮层时才用）

在 `~/.dsh/live2d/config.json` 写：

```json
{
  "modelFile": "D:\\models\\DeepSeek-chan\\大肥鱼.model3.json",
  "coreFile": "D:\\live2d\\live2dcubismcore.min.js",
  "overlay": true
}
```

或者在 desktop profile 的 `cordis.patch.yml` 里覆盖：

```yaml
- id: deepseek-live2d
  config:
    overlay: true
```

`overlay: false` 会**关闭**页面内的桌宠浮层（用于只跑独立桌面窗口的场景）。

### 5. 独立桌面窗口（可选，覆盖整个桌面）

页面内浮层只在 DSH 窗口范围里；想要「透明置顶、盖住整个桌面」的桌宠，用独立窗口模式：

```powershell
npm i -g electron@33          # 只需装一次
npx dsh-live2d-desktop
```

它读取同一份 `~/.dsh/live2d/config.json`。**这个窗口不会随 DSH 自动启动**，
需要的话把它加进开机启动项，或启动后用托盘图标管理。


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
