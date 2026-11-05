# Thinking v2 第三轮：现有表情与手势

状态：候选预览，等待人工验收；未提交、推送、合并、发布或替换正在使用的插件。

| 应用事件表现 | 现有手部资源 | 现有表情 |
|---|---|---|
| Normal Thinking / tool-call-delta | GrassOut 狗尾草，退出时 GrassBack | key7 脸红，强度0.24 |
| Deep Thinking / reasoning-delta | FingerOut 竖食指，退出时 FingerBack | key13 冷汗，强度0.60 |
| Waiting Response / running、start、无细分字段或推理流结束 | 默认手，先收回上一姿态 | 自动表情淡退，不强制苦思或加载脸 |

此映射是可调整的美术候选，冷汗仅作“更费力”的表现，不证明模型实际认知强度，也不把等待时长作为深度推理依据。扶下巴仍无现有动作资源，本轮不声称实现。

头身微动沿用第二轮的分时随机控制。手势只在状态/阶段变化时切换，不固定周期循环。由现有 activate 串行链执行：先播放旧手势收回约1.3秒，再播放新姿势或 Answering / Idle；快速新事件使旧链失效。手势期间呼吸、眨眼、微动、原物理链继续执行。用户手动动作和点击手势优先；恢复自动时重新建立对应的自动手姿。表情是 saveParameters 之后的临时增量，约0.4秒时间常数渐变，保留用户已开启的脸红/冷汗设置，不写入衣装偏好。

本轮修改：renderer/viewer.js；新增 src/runtime/thinking-accents.mjs 与 test/thinking-accents.test.mjs；test/idle-renderer.test.mjs 接入表情生命周期测试；本记录 docs/THINKING-BEHAVIOR-V2-REVISION3.md。没有改原始表情/动作资源、ArtMesh、物理配置、A1.2绑定、腿部实验或依赖。

完整 npm test：121/121 通过，0失败、0跳过。新增测试覆盖表情渐变/归零/让权；执行真实 renderer activate 源码验证 GrassOut → GrassBack → FingerOut → FingerBack → Idle，以及 FingerBack → Answering → Return；快速状态切换跳过过期动作；手动锁阻止自动动作。原有边界、随机性、渲染生命周期、交互和桥接回归继续通过。见 regression-revision3.log。

五组 revision3 GIF 使用真实本地模型和原 Cubism Core 回放合成应用事件，每组约12秒，480×720。转说话/转待机约第5秒发出事件，手势先收回，再开始后续动作，因此完整手势切换略晚于事件。循环接缝是GIF重播，不代表应用过渡。抽帧确认模型手姿出现并能回收，动画自然程度等待人工观看。

revision3-source.zip 为完整累计候选源码；revision3.patch 为相对原 main 基线 7ad928af0d1815309313b62d188c70367d399318 的累计补丁，不能直接叠加到已应用前两轮补丁的目录。先在干净基线上 git apply --check 再应用。原 thinking-v2-before.bundle 回滚点及前两轮交付保留，原工作区未改动。

录制修正：原收回动作可能错过精确末帧，单独关闭手型也不能清除手臂残留。最终实现从原 GrassBack / FingerBack 资源读取手部曲线的末帧值，在收回动画结束后确认精确终姿，再进入下一动作。只接收白名单手部参数，排除头身和其他曲线；默认手状态下在动作更新之后确认终姿，避免队列中的残留曲线再次带回旧姿势；收回动画、说话、手动动作或点击交互期间不执行此复位。没有猜测手臂姿势，也没有改原始资源或绑定。新增资源端点白名单测试，最终完整回归121项通过；最终GIF重新录制。
