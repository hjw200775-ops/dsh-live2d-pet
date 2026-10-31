# 第三方资源与许可核对

检查日期：2026-10-30。以下区分包内实际条款、官方 SDK 条款和本实现采取的措施，不将“免费资源”称为允许任意再分发的开源模型。

## 模型

已读取用户 ZIP 中 `DeepSeek-chan Free Live2D Model – Terms of Use & Setup Guide.txt` 和 PSD 英文使用指南。条款允许个人内容创作、展示、参数调整及个人二创；禁止转售及未经授权把完整模型上传到其他平台供直接下载。部分商业用途须先联系作者。公开作品应注明作者和来源。该许可不适用于插件新写代码。

署名：DeepSeek-chan；Illustration & PSD Layer Separation / Model Release：Kamiya Ryoko / 神宫凉子；Live2D Rigging：霓虹猫_NeonNeko。插件显示上述署名，不声称模型是本插件制作。

模型、纹理、PSD、原许可文档留在工作区私有 work 目录。交付的插件源码及 tgz 不含模型。原文件入口不被改写；插件仅在内存中添加 Idle/表情引用。无模型上传接口。未核实原作者下载页 URL，因此没有编造下载链接；分享模型时应使用用户取得资源的原始页面。

## Cubism Core 与 SDK

- [Core 官方说明](https://docs.live2d.com/en/cubism-sdk-manual/cubism-core/)：Core 属专有许可部分，官方未把 Core 发布到 GitHub。
- [专有软件许可](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)：第 5 节列出可再分发代码的条件；不能把“可再分发代码”理解为可任意镜像 SDK 或套用 MIT 许可。
- [SDK 发布许可](https://www.live2d.com/en/sdk/license/)：有针对可扩展应用以及 AI/聊天界面的专门说明。本插件采用外部模型路径，可能涉及可扩展应用定义；这是待官方确认的分类判断，不能假定个人/小规模豁免必然适用。
- [Web SDK 下载页](https://www.live2d.com/en/sdk/download/web/)：使用者应核实并遵守当前适用协议。

本次只为本机兼容性验证下载官方域名提供的 `https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js`，存放在包外私有目录。没有修改 Core、没有把它加入 npm 包、仓库或源码压缩包，也没有声明插件已获得公开发布许可。对外发布集成产品前需确认适用的出版许可、最终用户条款及必要告知。排除 Core 本身并不能自动排除集成应用的发布许可义务。

## 开源依赖

- [PixiJS](https://github.com/pixijs/pixijs)：6.5.10，MIT。
- [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)：0.4.0，包声明 MIT；随包 dist 中的 Cubism Framework 部分保留 Live2D 的原有版权及 SDK/开源许可告知，不能仅凭 npm 包顶层 MIT 声明抹去它们。
- [Live2D Cubism Web Framework](https://github.com/Live2D/CubismWebFramework/blob/develop/LICENSE.md)：Framework 与 Core 的许可不同，实际依赖产物保留原始告知。

依赖原样从包管理器安装并保留其许可文件和内嵌版权头。`package-lock.json` 锁定依赖；发布前还应对选定依赖版本及传递依赖重新审查。
