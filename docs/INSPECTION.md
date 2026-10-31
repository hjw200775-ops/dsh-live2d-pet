# 实际检查与验收记录

## 输入与工作区

初始工作区只有 `work/`、`outputs/`，无 DSH 源码、Git 仓库或 AGENTS.md。未猜测远程仓库，也未创建公开仓库。新代码位于 `outputs/dsh-deepseek-live2d/`。

历史聊天附件已通过 read_thread 定位；与本次用户指定的 `D:\DeepSeek-chan  DeepSeekFree Live2D Model + Layer.zip` 对比，SHA-256 相同：

`f3341cda80c678bf8ee7e88e3b6f0153c95a327de1a99294ae0d1bcb48f0d777`

因此本次实际分析适用于两个路径的同一原始压缩包，不依赖旧回答的结论。

## DSH 和现有范例

检查本机 `E:\DSH\resources\app.asar` 内正式发行的 JS 和 README，以及已安装 profile 中插件包。宿主版本 0.2.0-rc.2；Cordis + ESM Node 后端，React/客户端模块工厂前端。启动管理命令为 `E:\DSH\resources\runtime\cli\bin\dsh.cmd`。

- `@deepseekstudio/dsh-deepseek-pet@0.2.14`：`index.js` 导出 name/inject/apply，`cordis.patch.yml` 插入 `dsh-pet`。宿主 Node 服务桥接余额/状态，spawn 独立 `DeepSeekPet.exe`；pet-src 是 C#，不是 Live2D。
- `dsh-plugin-wallpaper-engine@1.4.0`：实际 package.json 的 `dsh.bundle.patch`、`dsh.client.platform: web`、`./client` 导出；后端使用 `ctx.webServer.register()`，前端使用 `window.__ModuleLoader__.load({id,factory})` 和 `ctx.effect()`。
- `@deepseek-ai/dsh-host-webserver@0.2.0-rc.2`：`register({kind:'exact'|'prefix',path,handler(req,res)})` 返回注销函数，host/port getter；插件负责 HTTP 资源。
- `@deepseek-ai/dsh-client-modules@0.2.0-rc.2`：manifest 扫描与 `./client` 工厂装载，副作用应归插件生命周期所有。Electron 使用宿主 bridge，不假定 file:// 相对 iframe 能访问模型。

没有发现通用“插件创建透明原生窗口”能力。替代方案是宿主内透明 iframe 加本机回环服务；整体移动是 DOM 操作，不假装调用宿主窗口 API。服务只监听 loopback，随机端口/路径，无余额和凭据依赖。

## 模型实际结构

ZIP 根目录有 DeepSeek、psd 和英日使用指南。运行入口 `DeepSeek/大肥鱼.model3.json` 的 Version=3 是 JSON 格式版本，不等于 Cubism Editor 3。MOC3 文件签名正确，头部 MOC 版本字节为 5；官方 Core 常量对应 Cubism 5.0。

- Moc：`大肥鱼.moc3`；Physics：`大肥鱼.physics3.json`；DisplayInfo：`大肥鱼.cdi3.json`。
- 纹理：`大肥鱼.4096/texture_00.png` 至 `texture_04.png`，共 5 张。
- 动作 8 个：IDLE、举手切默认手、狗尾草切回默认手、狗尾草切换出来、竖手指切出来动画、竖手指切回默认、脱捕、默认手切举手。
- 表情 23 个：体型1、体型2、兔牙、前倾、加载、单片眼镜、圈圈眼、尾巴开关、屑屑眼、流冷汗、流泪、爱心眼、竖食指关、竖食指开、胸口衣服、脱鞋、脸红、裙子切换、钢盆、黑框眼镜、黑脸、默认体型、＞＜。
- 另有 VTube Studio、VBridger 配置和分层 PSD；渲染不加载 PSD 或追踪配置。

原入口没有 `Motions` / `Expressions`。IDLE 的 Meta：Duration 5.983 秒、60 fps、Loop=true、21 条曲线，AreBeziersRestricted=false。插件生成内存引用，保留原始文件。

## 已执行验证

- 自动化 HTTP 测试：仅允许被引用资源、拒绝越界/未知路径、拒绝非 GET/HEAD、非法编码返回 400；模型入口不被改写；卸载注销路由并关闭回环服务；配置缺失明确报错。2 项通过。
- 本机 Edge 后台实例，软件 WebGL：实际加载 5 张纹理及 MOC，人物可见；画布 alpha=true。首轮帧数 17，等待 7.5 秒后 363，Idle 仍播放。缩放后 zoom=1.15；拖动后 offset=[40,20]；暂停前后帧数均 383。原始截图人工检查通过。
- 真实 DSH Web 宿主：在工作区内独立 DSH_HOME 安装 tgz、从官方 CLI 启动。客户端工厂自动挂载一个浮层，iframe 内实际帧数 73、Idle 播放；页面脚本错误 0。未复用用户凭据或日常 profile。
- 最终交互补测：整体浮层从 (916,386) 移到 (766,266)；收起后帧数固定 106，展开后恢复到 133；只有一个浮层，页面脚本错误 0。DSH 首次启动说明和 API Key 引导按“稍后配置”关闭，未配置或使用任何密钥。
- 发现并修复 iframe 深色 color-scheme 造成的黑色底板；最终截图已人工检查，在 DSH 白色页面上背景透明、人物清晰可见。
- 最终 tgz 和源码 ZIP 均逐项检查，不含模型、纹理、PSD、Core 或本地配置；源码 ZIP 包含 lockfile 与测试，tgz 仅包含插件运行文件、脚本和文档，依赖由包管理器安装。

后续桌面安装与共存实测见 [DESKTOP-VALIDATION.md](DESKTOP-VALIDATION.md)。仍未完成 GPU 硬件兼容矩阵与公开发行许可确认。
