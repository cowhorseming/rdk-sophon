---
name: servo-control
description: 通过 sophonctl 安全地测试和控制 MagicBox 舵机动作，包括单手与双手动作。
---

# MagicBox 舵机控制

## 适用场景

当用户要求测试或控制 MagicBox 舵机时使用本 Skill。当前支持：

- `init`
- `lift-left`
- `lift-right`
- `lower-left`
- `lower-right`
- `stand`
- `relax`
- `shake-ears`
- `flash`
- `servo <index> <duty>`
- `wave-hands`
- `wave-left-hand`

## 安全规则

1. 在机器人应用模式中，动作式自然语言就是对映射动作的一次执行授权；无需再次询问。仅询问能力、命令或状态时不得驱动舵机。
2. 如果用户明确报告机器人不稳、运动路径有障碍物或其他危险，则停止动作并报告原因。
3. 先只读执行 `sophonctl plugins list`，确认存在 `id: servo`。
4. 不把 `--hold inf` 用作默认值；只有用户明确要求持续保持并知道可用 Ctrl-C 中止时才能使用。
5. `servo <index> <duty>` 缺少 index 或 duty 时停止并报告必填参数缺失，不能猜测；应用模式可等待用户补充，研发流程不得因此阻塞。
6. 一次只执行一个动作，不并行发送舵机命令；失败后不重复原动作。

## 前置检查

```bash
sophonctl plugins list
sophonctl servo --help
```

指定板子时，把全局参数放在插件名前：

```bash
sophonctl --board x5 plugins list
sophonctl --board x5 servo --help
```

插件不存在、板子不可达或帮助输出不包含目标动作时停止，并报告真实错误。

## 应用模式执行流程

动作式请求且前置检查通过后，直接执行唯一映射命令一次，不得停在列表或帮助检查。例如“挥动左手”：

```bash
sophonctl servo wave-left-hand
```

指定 X5 时执行：

```bash
sophonctl --board x5 servo wave-left-hand
```

每一步等待命令结束并检查响应：`exit` 必须为 `0`，`stderr` 应为空，非空 `stdout` 应回传给用户。命令失败时停止并报告真实输出。

## 自然语言到命令映射

| 用户意图 | 命令 |
|---|---|
| 初始化舵机 | `sophonctl servo init` |
| 左腿抬起 | `sophonctl servo lift-left` |
| 右腿抬起 | `sophonctl servo lift-right` |
| 左腿放下 | `sophonctl servo lower-left` |
| 右腿放下 | `sophonctl servo lower-right` |
| 站立 | `sophonctl servo stand` |
| 放松/卸力 | `sophonctl servo relax` |
| 摇耳朵 | `sophonctl servo shake-ears` |
| 灯光动作 | `sophonctl servo flash` |
| 灯光动作但不操作灯带 | `sophonctl servo flash --no-lamp` |
| 左右手协调摆动 | `sophonctl servo wave-hands` |
| 挥动左手、摆动左手、摇摇左手 | `sophonctl servo wave-left-hand` |

动作完成后的默认保持时间由插件决定。需要有限保持时使用 `--hold <秒数>`；只有用户需求或设备配置明确要求交换引脚时才使用 `--exchange`。

## 单舵机操作

只有用户同时提供 index 和 duty 时才执行：

```bash
sophonctl servo servo <index> <duty>
```

不得自行推断插件未声明的安全范围。

## 结果报告

报告实际板子、执行命令以及每步的 exit/stdout/stderr。没有位置反馈时写“命令链路验收通过，未采集舵机位置反馈”，不能自行声称物理位移已被测量，也不能因此请求人类接入。
