# DSH DeepSeek-chan Live2D V0.2

适用于本机 DSH 0.2.0-rc.2，已安装到日常 desktop 配置。代码 MIT；模型和 Cubism Core 采用各自许可，交付包不包含这两类资源。

## 状态表现

| DSH 状态 | 桌宠表现 |
|---|---|
| 待机 | Idle，清除临时表情 |
| 思考 / 工具步骤 | Idle + 加载表情 |
| 回答正文 | 举手动作 + 脸红表情 + 示意性嘴部动作 |
| 错误 | 流冷汗；必要时收手，保留约 6 秒后回到当前活动状态 |

状态来自已安装宿主的 `agent/status`、`agent/assistant-stream`、`agent/error`，没有通过抓取聊天 DOM 或猜测输出文字来识别。思考阶段指宿主运行但尚无正文的阶段，也包括排队与工具步骤，不等于逐 token 判断模型内部推理。嘴部是示意动画，不是音频口型同步。

多个回合并行时使用“错误 > 正在回答 > 正在思考 > 待机”的全局聚合；一个会话结束不会把另一个正在运行的会话置为空闲。它跟随整个 DSH 宿主，并不限于当前可见聊天。

## 保存与使用

- 拖动“移动”按钮移动整个浮层；画布内拖动人物可微调偏移。
- 滚轮或 ＋/− 缩放；“复位”恢复人物比例和画布内偏移，不重置整个浮层位置。
- 整个浮层的位置、人物偏移和缩放会自动保存到配置文件同目录下的 `preferences.json`。
- 本机存档为 `C:\Users\huang\.dsh\live2d\preferences.json`，完全退出 DSH 后再启动会恢复。
- 恢复时会把浮层限制在当前视口内，避免更换分辨率后完全跑到屏幕外。
- “暂停/继续”控制动画；收起会暂停绘制。暂停状态和收起状态暂不跨重启保存。

## 安装和启动

本机已完成安装。直接打开日常 DSH 即可。模型、Core、本地配置及安装包均已保存在 `C:\Users\huang\.dsh\live2d`，运行不依赖 Codex 工作区。

在其他位置使用源码时：

```powershell
npm ci --ignore-scripts
python scripts/prepare-model.py '<用户模型压缩包>' --destination '<源码目录外的私有模型目录>' --core '<官方 Core JS 的绝对路径>' --config '<本地配置 JSON>'
node scripts/preview.mjs '<本地配置 JSON>'
```

`modelFile` 和 `coreFile` 必须为实际绝对路径；可选 `preferencesFile` 指定存档路径。独立预览只展示模型和待机，不代表 DSH 状态联动验收。

安装到 DSH：

```powershell
& 'E:\DSH\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add '<绝对路径>\dsh-deepseek-live2d-0.2.0.tgz'
```

在 desktop 的 `cordis.patch.yml` 数组中保留其他配置，添加或更新：

```yaml
- id: deepseek-live2d
  config:
    configFile: 'C:\Users\huang\.dsh\live2d\config.json'
```

**更新宿主代码后必须从“应用 → 退出”完全退出 DSH，再重新启动。** 只刷新页面或仅加载新客户端可能让旧后台配上新页面，出现资源接口 404。支持 Node >=22.12；本机使用独立回环端口加随机路径令牌隔离渲染，要求 DSH webServer 监听 127.0.0.1。

## 改动文件

- `src/activity.js`：基于真实宿主事件的聚合状态机，错误保留、并发回合和无正文的诊断历史。
- `src/preferences.js`：数值校验、部分配置合并、串行原子落盘。
- `src/index.js`：宿主事件订阅、配置读取和卸载清理。
- `src/viewer-server.js`：SSE 状态推送、受令牌保护的存档接口、模型资源白名单。
- `src/model.js`：在内存中补充 Idle / 举手 / 收手和表情引用，不修改原模型。
- `client.js`：DSH 客户端工厂、浮层移动/恢复、iframe 来源校验、启动等待重试。
- `renderer/`：动作/表情切换、缩放/偏移恢复、透明画布、状态标记。
- `test/`：真实事件分片契约、并发、报错时序、存档恢复、资产隔离和卸载回归。

## 验收与限制

详见 [V0.2 实机验收记录](docs/V02-VALIDATION.md)。此前 V0.1 的历史验收保留在 docs 中。

- 浮层在 DSH 内，不能拖出窗口；透明区域仍接收鼠标，没有逐像素点击穿透。可移动或收起避开聊天输入和发送按钮。
- 未实现语音、音频口型、多角色切换或当前聊天独占跟随。
- 本机模型已验证；其他模型如果缺少对应动作/表情，需要另行映射，不保证套用本模型动作名即可运行。
- 5 张 4096 纹理占用显存；兼容性结论仅覆盖本机测试组合。
- 没有公开发布或提交模型资产；SDK 对外发布条件仍需按 [第三方许可](docs/THIRD-PARTY.md) 确认。

## 停用与卸载

插件页关闭 `dsh-deepseek-live2d` 即可停用；重新启用会自动重连。卸载：

```powershell
& 'E:\DSH\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop remove dsh-deepseek-live2d
```

再移除该插件的单独配置覆盖项。私有模型和 preferences.json 不会由插件删除。恢复旧版本可安装私有目录中保留的 0.1.2 安装包并完全重启；不要直接覆盖整个旧 profile 配置，以免丢失后续用户改动。
