# 1. probectl CLI 契约

> 命令行客户端，本地（Unix socket）或远程（TCP）操作守护进程。
> 复用 `client::Client`，与 daemon 走同一套 NDJSON 协议。
> 实现源码：`crates/api-cli/src/main.rs`

## 1.1 在哪能跑 + 安装

`probectl` 是**纯客户端工具**（不存状态、不采集硬件，只发请求/收响应/打印），所以**不限于板子**——只要满足两点，任何机器都能用：
1. 该机器能跑 `probectl` 二进制（架构/系统对得上，见下表）。
2. 该机器能连到板子的 `probe-daemon`（TCP `7777` 可达，或本地 Unix socket）。

| 在哪跑 | 怎么编译 | 怎么连 daemon | 备注 |
|--------|---------|--------------|------|
| 板子上 | 板上 `cargo build --release --bin probectl`，产物 aarch64-linux | Unix socket（本地）或 TCP 回环 | 板端本地调试 |
| Mac | `cargo build --release --bin probectl`，产物 aarch64-apple-darwin | `--host <板子IP>:7777`（TCP） | 开发机远程操作板子 |
| 云端 Linux 服务器 | 服务器原生 `cargo build`（x86_64 或 aarch64） | `--host <板子IP>:7777`（TCP） | 云端运维/自动化 |

**关键**：`probectl` 能否用，不取决于在哪编译，而取决于**它所在机器到板子 7777 的网络通不通**。板子在 NAT 后、云端连不进板子时，`probectl` 没用——那种场景用 `probe-ws-outbound`（板子主动外连云端，见 [`../transport/ws-outbound.md`](../transport/ws-outbound.md)）。

### 各平台编译与安装到 PATH

`probectl` 二进制是单文件、无运行时依赖，编完拷到 PATH 即可全局敲 `probectl`（不用写完整路径）。

```sh
# Mac（开发机）
cargo build --release --bin probectl
cp target/release/probectl /usr/local/bin/        # 或 ~/.local/bin/，确保在 PATH 里
probectl --host <板子IP>:7777 state                 # 现在能直接敲 probectl 了

# 板子（已随部署装到 /usr/local/bin/probectl，见 deploy/install-on-board.sh）
probectl state                                      # 走本地 Unix socket

# 云端 Linux 服务器
cargo build --release --bin probectl                # 服务器原生编
sudo cp target/release/probectl /usr/local/bin/
probectl --host <板子IP>:7777 state
```

> 注意：Mac 编的二进制（apple-darwin）**不能**拿去 Linux 跑，反之亦然——每台机器编自己平台的。交叉编译到别的平台见 [`../../deploy/docs/build.md`](../../deploy/docs/build.md)。

## 1.2 调用

```sh
probectl [全局参数] <子命令> [子命令参数]
```

## 1.3 全局参数

| 参数 | 短/长 | 默认 | 环境变量 | 说明 |
|------|-------|------|---------|------|
| `--host` | long | 无（走 unix） | `PROBE_HOST` | 远程板子地址 `ip:port`；指定则走 TCP，否则走 Unix socket |
| `--socket` / `-s` | short/long | `/run/probe-daemon/probe.sock` | `PROBE_SOCK` | 本地 daemon 的 Unix socket 路径（仅 `--host` 未指定时生效） |
| `--timeout` | long | `30` | 无 | 响应超时（秒） |
| `--raw` | long flag | false | 无 | 紧凑 JSON 输出（默认 pretty） |

环境变量优先级低于命令行参数。

## 1.4 子命令

| 子命令 | 额外参数 | 后端 JSON-RPC | 说明 |
|--------|---------|-------------|------|
| `ping` | 无 | `ping` | 连通性 |
| `state` | 无 | `get_state` | 完整状态 |
| `thermal` | 无 | `get_thermal` | 温度 |
| `cpu` | 无 | `get_cpu` | CPU |
| `memory` | 无 | `get_memory` | 内存 |
| `disk` | 无 | `get_disk` | 磁盘 |
| `net` | 无 | `get_net` | 网络 |
| `bpu` | 无 | `get_bpu` | BPU |
| `refresh` | 无 | `refresh_state` | 立即刷新 |
| `exec <CMD...>` | 剩余所有参数（`trailing_var_arg`） | `exec_shell` | 执行 shell（需 `[shell] enabled`） |
| `raw <method> [params]` | `method` 位置参数；`params` 可选 JSON 对象字符串 | 任意 | 高级：发任意方法 |

## 1.5 示例

**本地**：
```sh
probectl state
probectl thermal
probectl exec uname -a          # 需服务端启用 shell
probectl exec "ls /tmp | head"
```

**远程**（开发机连板子）：
```sh
probectl --host 192.168.128.10:17777 state
probectl --host 192.168.128.10:17777 exec uname -a
```

**环境变量**（避免每次敲 `--host`）：
```sh
export PROBE_HOST=192.168.128.10:17777
probectl state
probectl thermal
```

**raw**（发任意方法）：
```sh
probectl raw get_bpu
probectl raw exec_shell '{"cmd":"echo hi"}'
```

## 1.6 输出

- 默认 pretty JSON（`serde_json::to_string_pretty`）。
- `--raw` 紧凑 JSON（适合管道）。
- 服务端错误时以非零退出码退出，stderr 打印 `Error: 服务端错误 <code>: <message>`。

## 1.7 exec 参数处理

`exec` 用 `trailing_var_arg`，**剩余所有参数**用空格 join 成单字符串作为 `cmd`。
含 flag 的命令需用 `--` 分隔或引号：
```sh
probectl exec -- ls -la          # -- 后的 -la 不被 probectl 解析
probectl exec "echo hello world" # 引号整体作为一个参数
```

## 1.8 退出码

| 退出码 | 含义 |
|--------|------|
| 0 | 成功 |
| 1 | 服务端错误 / 连接错误 / 解析错误 |
| 2 | CLI 参数解析错误（clap） |
