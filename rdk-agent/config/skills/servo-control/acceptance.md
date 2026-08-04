# Servo-Control Skill 验收场景

## 自然语言触发映射

- “挥动左手”“摆动左手”“摇摇左手”唯一映射为 `sophonctl servo wave-left-hand`。
- 指定 X5 时映射为 `sophonctl --board x5 servo wave-left-hand`。
- 动作式输入不需要二次确认；能力、命令或状态查询不得驱动舵机。

## 参数边界

- `wave-left-hand` 不需要动作专属的位置参数，但入口源码为所有动作提供 `--hold`、`--exchange` 和 `--no-lamp` 通用选项。
- 默认不使用 `--hold inf`；只有用户明确要求持续保持时才允许使用。
- `plugin.toml` 的 `[actions]` 空字符串不是参数 schema。

## 静态合同与测试证据

- `test_wave_left_hand.py` 中的 `test_wave_left_hand_sequence` 验证调用顺序严格为 `lift_left` → `lower_left`，且没有右侧方法调用。
- `test_wave_left_hand.py` 中的 `test_wave_left_hand_is_left_only_action` 验证 `wave-left-hand` 属于 `LEFT_ONLY_ACTIONS`。
- `test_cli_contract.py` 中的 `test_actions_contain_wave_left_hand` 验证动作已进入 `ACTIONS`。
- `test_cli_contract.py` 中的 `test_main_dispatches_wave_left_hand` 验证 main 只启动左侧 PWM 并调用 `wave_left_hand`。
- `test_cli_contract.py` 中的 `test_start_left_does_not_touch_right_pwm` 验证左侧启动不会触碰右侧 PWM。

## 失败与安全场景

- 前置的 `sophonctl --board x5 plugins list` 未发现 `id=servo` 时停止，不执行动作。
- CLI 返回非零 exit 或 stderr 时停止并回传真实结果，不自动重试物理动作。
- Skill 必须保留已有动作、一次只执行一个动作，并且不得绕过 sophonctl 直接访问硬件。

## 真机边界

- mock 测试只能证明函数调用顺序、CLI 分发和左右通道隔离，不能证明真实舵机的角度、力度或实际位移。
- 实际只动左手由后续真机验收 Agent 执行，命令成功作为自动验收结果；CLI 的 exit=0 只证明命令链路成功，未采集位置反馈。
