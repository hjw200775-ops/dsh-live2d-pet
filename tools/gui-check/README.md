# GUI 验收脚本（隔离窗口）

在**不干扰正在运行的 DSH** 的前提下，启动一只独立配置的桌宠窗口，用 CDP 操作真实页面做 13 项互动验收。
脚本只用 Node 内置能力（`child_process` / `net` / 内置 `WebSocket` / `fetch`），没有引入任何测试框架或新依赖。

## 前置条件

- Windows + 已安装的 Electron（插件下载后通常在 `~/.dsh/live2d/electron/<版本>/electron.exe`，也可用 `--electron` 指定）。
- 可用的 DeepSeek-chan 模型与 Live2D Cubism Core（**只读引用，不会复制**）。
- Node ≥ 22.12（仓库 `engines` 要求；脚本用到全局 `WebSocket`）。

## 复跑方式

```powershell
cd <仓库根目录>

node tools/gui-check/run.mjs `
  --model "$env:USERPROFILE\.dsh\live2d\DeepSeek-chan\大肥鱼.model3.json" `
  --core  "$env:USERPROFILE\.dsh\live2d\live2dcubismcore.min.js"
```

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--electron <path>` | 指定 `electron.exe`；省略时自动在 `~/.dsh/live2d/electron/*/` 里找，其次读 `DSH_LIVE2D_ELECTRON` |
| `--workdir <dir>` | 隔离工作目录，默认 `%TEMP%\dsh-live2d-gui-check` |
| `--port <n>` | CDP 端口，默认自动挑空闲端口（只绑 `127.0.0.1`） |
| `--timeout <ms>` | 整体超时，默认 240000 |

退出码：`0` 全部通过，`1` 有用例失败，`2` 参数/环境问题，`4` 超时。

## 隔离与安全约定

- **独立配置**：每次运行在工作目录重写 `config.json`，只填 `modelFile` / `coreFile` 两个绝对路径，`autoFetchModel: false`。
- **独立 userData**：`DSH_DESKTOP_USER_DATA=<workdir>\userdata`，与日常 DSH 的 profile 完全分开。
- **独立日志与存档**：`desktop.log`、`preferences.json` 都落在工作目录内。
- **只读引用模型**：不复制、不修改模型与 Core；截图与报告只写工作目录。
- **端口**：`--remote-debugging-address=127.0.0.1` + 运行期端口，结束后确认端口已释放。
- **清理**：只 `taskkill /PID <自己记录的 pid> /T`，从不按 `electron.exe` 进程名批量结束；
  成功、失败、超时、Ctrl+C 都会走清理并写 `report.json`。
- **不入库**：工作目录默认在 `%TEMP%`；`.gitignore` 已忽略 `*.png`、`*.log`、`*.zip`。

> `ELECTRON_RUN_AS_NODE` 会被脚本显式删除：该变量存在时 `electron.exe` 会退化成普通 Node，
> `import 'electron'` 直接抛 `Cannot read properties of undefined (reading 'exports')`。

## 覆盖的 13 项检查

1. 窗口加载并暴露 `__dshDesktopReady` / `__dshInteraction`
2. 「互动反馈」控件齐全、默认 650 ms 全开
3. 头部/身体命中点可探测
4. 默认点头部出现气泡
5. 关闭头部反馈后点头部无反应
6. **方案 C**：关闭双击后两次快速点击只反馈一次
7. 双击开启时仍是「嘿嘿！」双击气泡
8. 中文气泡写入 `preferences.json`
9. 保存成功提示「设置已保存」
10. 模拟 413 时显示「未保存：设置太大…」且标红
11. 保存失败时磁盘未被改写
12. 重启后互动配置保留
13. 重启后面板回显已保存的中文气泡

报告写入 `<workdir>\report.json`（`{ ok, checks[], workdir, port, at }`），日志同目录 `desktop.log`。

## 已知限制

- 只在 Windows 上验证；其他平台的分支存在但未实测。
- 动画观感（速度、幅度、遮挡）仍需人眼确认，脚本只验证"行为按预期发生"。
- 模型/核心缺失时脚本直接退出（码 2），不会尝试下载。
