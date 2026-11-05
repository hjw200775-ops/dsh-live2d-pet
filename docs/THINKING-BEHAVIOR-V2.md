# DSH Thinking Behavior v2 检查与实现报告

状态：候选实现完成，等待人工视觉验收。未提交、未推送、未合并、未发布、未替换正在运行的插件。

## 1. 修改前检查

实际从远程 main 建立隔离副本，基线为 `7ad928af0d1815309313b62d188c70367d399318`（0.7.4）。该提交在 `63acf41` 的 0.7.3 人工验收基线上发布，包含 `fb7edce` 的鼠标跟随和思考动作改进。候选分支：`codex/thinking-behavior-v2`。

找到的本地功能工作区交接文档仍记载 0.7.3；其 Git 状态无法读取，因此没有写入该工作区，也没有将历史实验副本当作基线。

| 检查项 | 已有功能与复用结论 |
|---|---|
| Thinking | `authored-motions.mjs` 已有 4 秒循环：AngleX/Y/Z 和向上眼球曲线；不是完全没有动作。原曲线保留供兼容，自动 Thinking 改用随机叠加控制器，不同时运行这两个控制源。 |
| Motion Scheduler | 当前对应 `activate` 的 Promise 串行链、epoch 失效检查、gestureLock/motionLocked 和 motion-policy；没有名为 Motion Scheduler 的独立组件。不重写调度系统。 |
| 过渡 | motion-policy 已修复直接 stopAllMotions 截断淡出的问题；已有分组 fades，继续使用。 |
| Idle | 已有 createIdleMotion、随机重心变化、噪声微动、呼吸、随机单/连眨、gaze、look follower，全部保留。 |
| 物理链 | natural-overlay 在动作 saveParameters 之后、physics 之前加增量，之后 loadParameters 恢复基线；新增头身控制复用此入口。 |
| 状态事件 | activity 已消费 agent/status、assistant-stream start / reasoning-delta / tool-call-delta / text-delta / finish 和 agent/error，但以前将等待与推理统一为 thinking。 |
| 模型资源 | 本地现有模型含 9 个 Animation 动作、衣装表情、头身控制器以及头发/衣服/尾巴物理。动作包括默认手/举手、竖指、狗尾草、脱捕；没有扶下巴动作。 |
| 思考表情 | 原 viewer 每帧强制 key8 加载脸与 Param140 固定转动；已取消自动强制加载。用户手动选择的表情仍生效。 |
| 抖腿实验 | 本次基线没有该实验模块；没有读取或改动实验分支，也没有改腿部通道、A1.2 绑定或 ArtMesh。 |

## 2. 最小实现

增加一个 thinking 控制器，仍使用原四个顶层状态，不修改底层模型或动作资源。Thinking 期间播放原 Idle 作为基础，再叠加思考微动；说话与 Return 继续使用原动作组和淡入淡出。

| 表现 | 真实可获得的事件依据 | 视觉 |
|---|---|---|
| Waiting Response | running / stream start；无细分字段的旧宿主；非错误且尚无回答的 stream finish | 身体放松，轻微漂移、呼吸、随机眨眼；不强制加载脸 |
| Normal Thinking | tool-call-delta | 小幅歪头、随机偏左上/右上、低幅重心变化 |
| Deep Thinking | reasoning-delta | 小幅低头、集中视线，保留呼吸与眨眼 |
| Speaking | 非空 text-delta | 思考增量渐退归零，原 Answering 手势和口部动画接管 |
| Idle | agent/status 离开 running，或桌面桥接超时 | 原 Idle 微动恢复；思考增量衰减归零 |

这些标签只表示已收到的应用事件，不测量内部推理深度，不按等待时间升级为 Deep。工具调用片段结束后回到等待；不推断工具正在做什么。多 agent 时沿用 error > answering > thinking > idle 的原有总状态优先级，思考中按已收到的 deep / normal / waiting 聚合。桥接只传递白名单阶段字段，不传推理或回答内容。

随机目标间隔为 2.8–7.5 秒，方向和幅度有界；头部、眼球、身体采用不同平滑时间。控制器最大增量：AngleX ±4、AngleY -7…约2、AngleZ ±3、PositionX ±0.012、眼球 ±0.3。目标幅度通常低于上限，不把各通道一起推到极值。眨眼复用原 2–6 秒随机间隔与 20% 双眨概率。长帧 dt 上限 50ms，不追赶隐藏期间的动作。

鼠标跟随活跃时，思考头部 X/Y 和眼球偏移渐退，让原跟随接管。手动动作、交互锁、拖动时，新思考控制器不写参数；眨眼和新增呼吸也让权。头发、衣服、尾巴的物理配置保持不变。

**未完成项：精确手扶下巴。** 现有动作资源不支持，当前三种表现均使用自然默认手；深度思考的低头/集中视线已经实现。要满足精确扶下巴，需另行制作并人工验收适配当前绑定的姿势资源。本轮没有通过猜测手臂参数或修改绑定来模拟它。

## 3. 修改文件清单

- `renderer/viewer.js`：接入微动、阶段显示、自动 Thinking 改用 Idle 基础、取消强制加载表情、交互让权。
- `src/runtime/thinking.mjs`：新增有界随机思考控制器与阶段白名单。
- `src/activity.js`：依据已有事件产生阶段；阶段改变时即使顶层 mode 不变也发布快照；断连清空阶段。
- `src/bridge.mjs`：传递 thinkingPhase。
- `src/viewer-server.js`：桥接接收并转交阶段字段。
- `test/thinking.test.mjs`：阶段、兼容、连续性、边界、随机性、让权和归零测试。
- `test/idle-renderer.test.mjs`：原渲染生命周期测试接入新控制器，并增加三阶段与两个退出路径。
- `test/bridge.test.mjs`：HTTP 桥接新增字段及旧发送端回退检查。
- `docs/THINKING-BEHAVIOR-V2.md`：本报告。

没有修改 package 版本、依赖锁文件、原始模型、Core、physics、ArtMesh、身体绑定、自然抖腿实验或原鼠标跟随算法。

## 4. 测试与动态预览

依赖按锁文件 `npm ci --ignore-scripts` 安装。完整 `npm test`：116/116 通过，0 失败、0 跳过。原基线共 112 项，新增 4 项；另扩展原桥接与渲染集成测试。

测试覆盖：10 分钟随机控制器边界与逐帧连续性；原渲染回调跨 save / physics / mesh / load 生命周期不累积污染；三阶段及两种退出；Thinking 中随机眨眼与呼吸复用；桥接字段传递、缺失/非法阶段回退、断连恢复；现有交互、鼠标、衣装、动作策略、服务器及发布约束回归。

初跑使用系统 TEMP 时文件测试失败并停滞，终止该次后将 TEMP/TMP 指向本聊天的 work/test-temp，重跑完整 npm test 全部通过，详见 `regression-final.log`。发布检查见 `release-check.log`，另外核对新文件和补丁没有模型/Core 或凭据。

五个 GIF：01-normal、02-deep、03-waiting、04-speaking、05-idle，各约 10 秒、8 fps。它们是在现有真实模型和 Cubism Core 上回放合成应用事件；不是实时请求，不证明内部推理状态。前3组展示进入思考及持续动作，后2组在约4秒时切换状态。GIF 循环接缝不代表应用状态切换；转说话/转待机请观察片段内部。

人工观感仍待用户确认。自动测试与录制截图不能代替视觉验收。静态抽帧初检：能看到头姿与物理变化，无明显模型破坏；深度思考相较普通更低头，等待保持放松。微动幅度刻意较低，是否足够自然需人工观看 GIF。Electron 非打包预览出现原有 CSP 开发警告，没有记录到其他控制台错误。现有调试参数钩子在每帧 loadParameters 后读取，显示的是已恢复基线，不能把其零值误当作动画未运动。

## 5. 回滚与人工验收

原有插件、其他工作区和远程 main 均未更改。当前候选实现只在隔离目录与交付源码包中；不采用该目录即可保持原运行版本。

修改前完整 Git bundle 为 `thinking-v2-before.bundle`，包含基线与历史，可在新目录运行：

```powershell
git clone .\thinking-v2-before.bundle .\thinking-v2-rollback
git -C .\thinking-v2-rollback switch --detach 7ad928af0d1815309313b62d188c70367d399318
```

`thinking-v2.patch` 含全部修改和新文件，可在同基线独立工作区先 `git apply --check` 再应用。若在干净的该基线上应用后需要撤销，先 `git apply --reverse --check`，确认后再反向应用；已有后续修改时不要强行回滚。源码包不包含 node_modules、用户模型或 Core，需按原项目流程安装依赖并引用本机已有资源。

验收重点：普通/深度/等待能否区分；思考是否仍显僵硬；眨眼是否自然；鼠标接管与手动动作是否正常；两个退出是否无突跳、残留偏头；确认默认手替代扶下巴这一缺项。完成后维持暂停，等待人工决定，不自动合并。
