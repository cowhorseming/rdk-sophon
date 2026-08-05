# rdk-platform

RDK 设备接入与智能编排平台。仓库采用 monorepo 组织；两个子项目可独立构建、测试、发布，当前放在同一仓库中以便比赛期间联调。

## 1. 子项目

| 目录 | 技术栈 | 职责 |
| --- | --- | --- |
| [`rdk-sophon/`](rdk-sophon/) | Rust | 板端 `probe-daemon`、`sophonctl` 客户端、HTTP/WS 接入与部署工具。 |
| [`rdk-agent/`](rdk-agent/) | TypeScript | 基于 Pi SDK 的机器人开发/应用多 Agent TUI 编排器及集成部署工具。 |

## 2. 系统关系

`rdk-agent` 不依赖 `rdk-sophon` 的 Rust crate，而是在自身的 `infra` 层通过开发机已安装的 `sophonctl` 连接板端 `probe-daemon`，从而保持两套系统的构建、发布与未来拆仓独立。

```text
开发机                                             RDK X5 板端
rdk-agent TUI ──> sophonctl ──TCP 7777──────────> probe-daemon
                                                     └─ servo 动态插件与应用脚本
```

## 3. 一键部署

集成部署入口属于 `rdk-agent`，但会编排两个子项目的交付物：

- **rdk-sophon 板端交付**：`probe-daemon` 等 aarch64 二进制、配置和 systemd 服务；
- **rdk-agent 板端交付**：MagicBox servo 应用脚本、带局部 registry 的独立动作包和插件 manifest；
- **rdk-sophon 开发机交付**：本机架构的 `sophonctl` 客户端；
- **rdk-agent 开发机交付**：TUI、Agent/Skill 配置和研发沙箱。

从仓库根目录按目标选择命令：

```sh
# 只部署板端：rdk-sophon 服务端 + rdk-agent 舵机运行文件
./rdk-agent/deploy/install-rdk-agent-stack.sh \
  --board-only --ssh-host x5-root --board-address 192.168.128.10:7777

# 只部署开发机：sophonctl + rdk-agent TUI + Podman 研发沙箱
./rdk-agent/deploy/install-rdk-agent-stack.sh \
  --development-only --board-address 192.168.128.10:7777

# 同时部署板端和开发机
./rdk-agent/deploy/install-rdk-agent-stack.sh \
  --ssh-host x5-root --board-address 192.168.128.10:7777
```

完整交付物、安装路径、前置条件和验证命令见 [`rdk-agent/README.md` 的“板端与开发机部署”](rdk-agent/README.md#3-板端与开发机部署)。

## 4. 本地开发

```sh
# Rust 设备接入子系统
cd rdk-sophon
./scripts/full_test.sh

cd ../rdk-agent
npm ci
npm run check
npm test
```

## 5. 拆仓边界

比赛结束后，`rdk-sophon/` 和 `rdk-agent/` 均可整体迁为独立仓库。它们不共享 Cargo/Node workspace，也不共享内部代码依赖；唯一集成契约是 `sophonctl` 的 CLI 与板端 RPC 接口。
