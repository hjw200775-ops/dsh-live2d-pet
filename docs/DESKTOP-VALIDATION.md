# 日常 DSH 桌面版安装与验收

日期：2026-10-30；DSH 0.2.0-rc.2，Windows，日常 `desktop` profile；安装版本 0.1.2。

## 实际安装位置

- 插件：`%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-deepseek-live2d`。
- 本地配置：`%USERPROFILE%\.dsh\live2d\config.json`。
- 模型：`%USERPROFILE%\.dsh\live2d\deepseek-chan`。
- Core：`%USERPROFILE%\.dsh\live2d\live2dcubismcore.min.js`。
- 安装包：`%USERPROFILE%\.dsh\live2d\dsh-deepseek-live2d-0.1.2-desktop.tgz`。
- 安装前备份：`%USERPROFILE%\.dsh\live2d\backups\desktop-before-20261030`，包含原 `package.json`、`cordis.patch.yml`、`pnpm-lock.yaml`。

私有模型和 Core 在 DSH 数据目录内，日常启动不依赖此次 Codex 工作区。模型入口复制前后 SHA-256 相同，原 JSON 未被修改。原模型英日使用指南一并保存在私有目录。交付安装包和源码 ZIP 不含模型、纹理、PSD、Core 或本机配置。

## 实机发现并修复

1. **桌面深色主题下白色底板。** iframe 内的画布 alpha 正常，但父页面暗色模式与子页面的颜色模式不同，Chromium 为子页面补了不透明背景。为 iframe 元素明确指定 `color-scheme:normal`，与子页面一致。已在日常桌面窗口直接确认人物后方能透出动态壁纸。后台浏览器还以绿色底色复测了颜色模式组合。
2. **重新启用后 HTTP 404。** 客户端插件可能先于异步宿主初始化完成，首次请求 bootstrap 的 404 使 UI 永久停住。客户端现在对短暂 404、5xx 和网络失败等待重试，最长约 16 秒；卸载时取消等待。400/403 等错误不会盲目重试。新增回归测试覆盖先失败后成功及等待中卸载的情况；日常桌面实际停用/启用复测已恢复模型。

主要改动为 `client.js`，版本及锁文件同步到 0.1.2。保留 V0.1 的宿主接口与隔离渲染架构。

## 验收结果

| 项目 | 实际结果 |
|---|---|
| Electron 内透明显示 | 通过；修复后无白色或黑色底板，能透出正在播放的壁纸 |
| Idle | 模型持续动画，多个窗口观察中姿态变化；未用静态图片代替 |
| 整体拖动 | 通过；拖动“移动”按钮后整个人物区域跟随 |
| 画布内拖动 | 通过；人物相对于区域平移，复位可恢复 |
| 按钮与滚轮缩放 | 通过；人物实际大小随操作变化 |
| 暂停/继续 | 通过；控制按钮切换，恢复 Idle |
| 收起/展开 | 通过；人物区域收起成 DeepSeek酱按钮，再展开恢复 |
| 插件停用清理 | 通过；浮层消失，先前随机回环端口关闭 |
| 插件重新启用 | 修复后通过；浮层重新加载且只出现一份 |
| 完全退出后启动 | 通过；加载日常配置、私有模型和原有壁纸 |
| wallpaper 共存 | 通过；原视频壁纸继续动画，拉绳能打开壁纸库；暂停/播放可独立操作，测试后恢复原播放状态 |
| 原有桌宠共存 | `DeepSeekPet` 原进程响应正常，跨 DSH 重启保持同一进程，没有重复实例；原游戏面板继续刷新；`/health` 返回 ok=true、版本 0.2.14 |
| 原有插件依赖 | 原桌宠、wallpaper、图像生成、GitHub router、人设插件的已声明版本均保留 |
| 自动化检查 | 3 项通过：客户端启动时序/取消、资产隔离/生命周期、缺失配置错误 |

测试没有向模型发送消息，没有更换壁纸，没有改动原桌宠的行为设置。为避免操作历史聊天，在 DSH 中打开一个空白“新会话”用于交互测试。

## 使用与恢复

打开日常 DSH 即加载。右上区域的“移动”用于移动浮层；画布滚轮和 ＋/− 用于缩放；“复位”恢复人物在区域内的位置和比例；“收起”保留小入口。

若要停用，在插件页关闭 `dsh-deepseek-live2d`。如需卸载，退出 DSH 后运行：

```powershell
& 'E:\DSH\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop remove dsh-deepseek-live2d
```

再从 desktop 的 `cordis.patch.yml` 移除仅属于 `deepseek-live2d` 的覆盖项。无需删除模型。不要直接把安装前整个配置备份覆盖回来，否则会覆盖安装之后的其他用户改动。

## 尚存限制

- 浮层只在 DSH 内，不能拖出应用窗口；没有逐像素点击穿透，透明矩形区域仍接收鼠标，可移动或收起来避开聊天区。
- 位置和缩放目前不跨重启保存。
- 本次兼容性结论限本机当前版本与当前壁纸；没有遍历所有 Wallpaper Engine 格式、GPU、主题和第三方插件组合。
- 原有桌宠验证是进程、健康接口及可见动画共存验证，未遍历其全部交互和游戏功能。
- 没有接入思考/回答状态；公开发布及 SDK 许可条件仍须按第三方许可文档确认。
