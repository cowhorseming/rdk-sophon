---
name: magicbox-command-authoring
description: 为 MagicBox 舵机控制实现符合现有代码规范、可交付且可移除的新指令。
---

# MagicBox 指令开发

目标项目默认是 rdk-agent 从内置版本化模板初始化的托管工作区，不要求用户下载 rdk-sophon 源码；仓库贡献者也可以显式提供外部工作区。舵机插件统一位于工作区的 `examples/plugins/servo/`。先阅读现有 `servo_ctrl.py`、相邻测试和板端 `/userdata/magicbox` 中能从代码证明的原子能力，只复用已有硬件接口。

内置动作只能修订现有入口。新增 rdk-agent 交付动作必须使用可管理模块：

- 实现放在 `examples/plugins/servo/servo_actions/<kebab-case 动作名转换为 snake_case>.py`；模块只导出 `run(controller)`。
- 在同目录 `actions.json` 的 `actions` 中登记动作名、同名 `.py` 模块及 `start` 策略（`left`、`right`、`both` 或 `none`）。
- `servo_ctrl.py` 会据此加载并执行动作；不要直接改写其中的 `ACTIONS`、`LEFT_ONLY_ACTIONS` 或 `RIGHT_ONLY_ACTIONS`。
- 这样用户可用 `sophonctl servo remove <动作名>` 原子下线该动作：活动 registry 条目和模块实现会被移除，并在 `.rdk-agent-backups/` 留下恢复备份。

新增用户能力时必须创建独立、可兼容的公开动作，不能改变已有动作的语义。Python 方法使用 snake_case，CLI 动作使用对应的 kebab-case；测试必须调用这个公开入口，不能直接调用底层 lift/lower 后声称已覆盖新功能。

单侧动作除了动作顺序，还必须证明不会启动另一侧 PWM。任何自动测试都要在导入脚本前同时向 `sys.modules` 注入 `Hobot` 与 `Hobot.GPIO`。

开发沙箱是离线 Python 3.12 标准库环境，不提供 pytest。测试使用 `unittest`，从 `examples/plugins/servo` 目录以 `python3 -m unittest tests/<test_file>.py -v` 运行；不安装依赖。
