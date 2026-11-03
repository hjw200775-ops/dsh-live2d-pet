# 开发入口

本仓库是 DSH（DeepSeek Harness）的 Live2D 桌宠插件，npm 包名 `dsh-deepseek-live2d`。
本项目采用**双设备、双模型平行开发**：主机（GPT Codex）做动画与观感，副机（DSH / DeepSeek）做功能与配置，
通过 GitHub 的 `main` 分支与本文档交接。

开工前必须：

1. 读 [开发交接中心](docs/DEVELOPMENT_HANDOFF.md)，确认**稳定基线 Commit**与当前分支；
2. 检查 `git status`，确认没有其他会话的未提交修改（同一工作区同时只允许一个会话写入）；
3. 对照源码与测试核实文档，**文档不是实现或验收完成的证明**。

硬性约束：

- 稳定基线是 `main` 上的最新提交；`codex/stage-a-*` 是**未合并实验**，不得当作既有功能引用、复用或发布。
- 不得修改 Live2D 原始模型资源、动作参数、变形器、物理配置与动画核心逻辑。
- 不得使用 force push、`reset --hard`、删除远端分支或改写历史。
- 未经用户明确确认，不得修改 `main`、合并分支、发布 npm 版本、创建 GitHub Release、删除现有文件。
- 不得把 API Key、Token、本机路径、模型或 Cubism Core 提交进仓库。
- 动画观感必须由用户人工验收；自动测试只证明所测约束，不能替代视觉确认。

文件归属、冲突规避与合并要求见交接文档的「文件归属」「合并要求」两节。
