# V0.2：状态联动与位置恢复实机验收

日期：2026-10-30。宿主为日常 DSH Electron 桌面版 0.2.0-rc.2，profile 为 desktop；插件版本 0.2.0。

## 实际接口依据

检查了本机正式安装包 `E:\DSH\resources\app.asar` 中 `@deepseek-ai/dsh-agent`、`dsh-agent-loop` 和 `dsh-llm` 的 JS 实现，沿用实际 Cordis 事件订阅接口：

- `agent/status`：payload 包含 `agent` 与 `status`，后者为 running / idle。
- `agent/assistant-stream`：payload.frame 的 type 为 start / chunk / end。chunk 帧的 `frame.chunk.type` 中 reasoning-delta 对应思考分片，text-delta 对应回答正文，tool-call-delta 对应工具阶段；finish 的错误原因为 `chunk.reason.kind === 'error'`。
- `agent/error`：回合失败时发布，包含 agent / turn / step / error。插件只使用事件类型与 agent 标识，不读取或向渲染层转发错误正文。

这些事件通过实际 agent 的 scope carrier 发布，并附带 agent 对象；插件根上下文使用 `ctx.on` 观察。未伪造 DSH API，未修改宿主核心，也没有通过聊天 DOM 抓取或关键词匹配识别状态。

状态聚合跨宿主中的并行回合，不限于当前可见聊天。错误优先显示约 6 秒；其他回合继续活动时，错误到期后回到聚合状态。宿主空闲通知不会立即覆盖刚收到的错误。开始运行但尚未输出正文时也归为“思考中”，它可能包括排队、请求准备与工具步骤，不代表观察模型内部推理内容。

## 模型映射

| 模式 | 动作与表情 |
|---|---|
| idle | IDLE.motion3.json + 清除临时表情 |
| thinking | IDLE.motion3.json + 加载.exp3.json |
| answering | 默认手切举手.motion3.json + 脸红.exp3.json；用实际存在的 ParamMouthOpenY 做示意性说话动画 |
| error | 流冷汗.exp3.json；从举手状态退出时播放 举手切默认手.motion3.json |

回答结束或进入其他阶段时，必要时播放收手动作，再由运行时回到 Idle。快速切换采用串行更新和版本检查，避免旧异步动作/表情加载覆盖较新的状态。口型不是语音同步。原模型文件未改写，引用只在内存中补充。

## 实际验证

1. **浏览器模型验证。** 将基于已核实事件格式的夹具输入状态机，实际加载用户模型，观察加载表情、举手/脸红、流冷汗及收手待机；同时检查 canvas 的实际模式与动作标记。保存 1.15 倍和 [35,-25] 人物偏移后，刷新恢复一致。此项是明确标注的事件夹具验证。
2. **日常桌面真实请求。** 在专用验收聊天中发送两条不含私人资料、要求不调用工具的普通短请求。真实宿主先后发布 thinking → answering → idle；正常回合的本机渲染元数据也记录到 thinking / 加载 / Idle 和 answering / 脸红 / Answering，最后为 idle / 无临时表情 / Return。桌面窗口中观察到状态标记和实际模型变化。
3. **日常桌面真实错误边界。** 为避免改动用户账号、密钥和默认模型，临时安装仅匹配专用验收 session 的一次性组件，在其下一次 `agent/request` 抛出清楚标注的受控错误。真实宿主产生 `agent/error`，插件进入 error 后约 6 秒恢复 idle。它验证的是宿主实际失败路径，不声称制造了真实供应商故障。一次性组件随后卸载，之后的正常请求成功；完整重启后确认组件不在依赖清单。
4. **位置与缩放完全重启。** 在日常窗口内拖动浮层、缩放及拖动人物。退出前存档为：zoom=1.15，x=22，y=-16，overlay.left≈939.9896，overlay.top≈131.9896。通过“应用 → 退出”确认窗口退出，再启动日常 DSH。截图中浮层回到原位置；新渲染服务上报 zoom=1.15、x=22、y=-16、mode=idle，存档与退出前完全一致。
5. **原有插件。** 同一桌面窗口的 wallpaper 持续播放；原有桌宠 `/health` 返回 ok=true、0.2.14。未更改其配置，也未向其他聊天发送测试请求。
6. **回归测试。** 5 项通过：真实分片契约与并发/错误优先级、存档重建与坏值过滤、客户端启动等待/取消、私有资源白名单及卸载、配置缺失错误。

运行中诊断仅包含模式、事件名称、时间、活动数量、动画标记、帧数和变换数值；不包含提示词、模型回答、错误正文、密钥或聊天标题。诊断保存在回环服务内存中，历史上限 80 条。

## 安装与数据

- 插件：`C:\Users\huang\.dsh\profiles\desktop\node_modules\dsh-deepseek-live2d`。
- 模型/配置/Core/存档：`C:\Users\huang\.dsh\live2d`。
- 存档：该目录下 `preferences.json`；修改采用数值校验、串行写入与同目录临时文件原子替换。
- 最终本地安装包：`dsh-deepseek-live2d-0.2.0-desktop.tgz`，置于上述私有目录。
- 0.1.2 旧包保留，可用于回滚；V0.2 升级前配置另备份在私有目录 `backups/desktop-before-v02`。

交付包排除模型、纹理、PSD、Core、本机存档和临时验证组件。更新涉及后端时必须完全退出 DSH 后启动；仅替换客户端会让新页面暂时遇到旧后台不认识的存档接口。本次升级已执行完整重启。

## 仍有限制

当前跟随宿主全局活动；错误保留时间固定约 6 秒。浮层仍在 DSH 内，没有逐像素点击穿透，透明矩形会接收鼠标，可能挡住聊天按钮，可移动或收起。缩放/偏移和浮层位置会保存，收起/暂停状态不会保存。SDK 对外发布许可与其他模型/宿主版本的兼容性未因此自动解决。
