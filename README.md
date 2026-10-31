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
dsh plugin --profile desktop add '<绝对路径>\dsh-deepseek-live2d-0.6.0.tgz'
```

### 2. 准备模型与 Core

- 模型：从 [GitHub Releases](../../releases) 下载 `DeepSeek-chan_model_for_dsh-live2d-pet_v1.zip`，
  解压到任意私有目录（不要放进本仓库）；
- Core：从 Live2D 官网下载 `live2dcubismcore.min.js`，同样放在私有目录。

### 3. 配置

`config.json`（路径自定，不要提交进仓库）：

```json
{
  "modelFile": "<模型目录>\\DeepSeek-chan\\大肥鱼.model3.json",
  "coreFile": "<core 目录>\\live2dcubismcore.min.js"
}
```

在 desktop profile 的 `cordis.patch.yml` 里追加：

```yaml
- id: deepseek-live2d
  config:
    configFile: '<绝对路径>\\config.json'
```

**改完从「应用 → 退出」完全退出 DSH 再启动**，只刷新页面可能出现资源 404。

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
