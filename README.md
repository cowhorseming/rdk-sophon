# rdk-platform

RDK 设备接入与智能编排平台。仓库采用 monorepo 组织；两个子项目可独立构建、测试、发布，当前放在同一仓库中以便比赛期间联调。

## 1. 子项目

| 目录 | 技术栈 | 职责 |
| --- | --- | --- |
| [`rdk-sophon/`](rdk-sophon/) | Rust | 板端 `probe-daemon`、`sophonctl` 客户端、HTTP/WS 接入与部署工具。 |
| [`rdk-agent/`](rdk-agent/) | TypeScript（待实现） | 多 Agent 编排子项目预留目录。 |

## 2. 系统关系

`rdk-agent` 将不依赖 `rdk-sophon` 的 Rust crate。后续应在自身的 `infra` 层通过已安装的 `sophonctl` 二进制连接板端的 `probe-daemon`，从而保持两套系统的构建、发布与未来拆仓独立。

```text
rdk-agent (server)
  └─ sophonctl --host <board-ip>:17777
       └─ probe-daemon (board)
```

## 3. 本地开发

```sh
# Rust 设备接入子系统
cd rdk-sophon
./scripts/full_test.sh

# rdk-agent 尚未实现；目录中仅保留架构说明
cd ../rdk-agent
```

## 4. 拆仓边界

比赛结束后，`rdk-sophon/` 和 `rdk-agent/` 均可整体迁为独立仓库。它们不共享 Cargo/Node workspace，也不共享内部代码依赖；后续唯一集成契约将是 `sophonctl` 的 CLI 与板端 RPC 接口。
