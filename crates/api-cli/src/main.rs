//! sophonctl：本地 CLI 或远程客户端。本地走 Unix socket，远程走 TCP（--host 或别名）。
//! 复用 client::Client（与 HTTP 网关、WS 出站同源），与 daemon 走同一套 NDJSON 协议。
//!
//! 连接目标优先级（高到低）：
//!   --host <ip:port>   >  --board <别名>  >  PROBE_HOST 环境变量  >  配置 [default]  >  本地 unix socket
//!
//! 配置文件 ~/.rdk-sophon/config.toml 管理板子别名表（见 mod config）。

mod config;

use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};
use client::{Client, ClientBuilder};
use shared::protocol::Params;
use std::time::Duration;

use config::SophonConfig;

#[derive(Debug, Parser)]
#[command(name = "sophonctl", about = "操作 rdk-sophon 探针守护进程")]
struct Cli {
    /// 远程板子地址（ip:port）。最高优先级，覆盖 --board/env/配置。
    #[arg(long, env = "PROBE_HOST")]
    host: Option<String>,
    /// 板子别名（来自 ~/.rdk-sophon/config.toml 的 [boards.<别名>]）。
    /// 次于 --host，高于 env/配置默认。
    #[arg(long)]
    board: Option<String>,
    /// 本地 daemon 的 Unix socket 路径（仅无远程地址时用）。
    #[arg(short, long, default_value = "/run/probe-daemon/probe.sock", env = "PROBE_SOCK", global = true)]
    socket: String,
    /// 响应超时（秒）。--board 配置里若有 timeout 会覆盖此默认。
    #[arg(long, default_value = "30", global = true)]
    timeout: u64,
    /// 原始 JSON 输出（不 pretty）。
    #[arg(long, global = true)]
    raw: bool,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Debug, Subcommand)]
enum Cmd {
    Ping,
    State,
    Thermal,
    Cpu,
    Memory,
    Disk,
    Net,
    Bpu,
    Refresh,
    Exec {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true, num_args = 1..)]
        cmd: Vec<String>,
    },
    Raw {
        method: String,
        params: Option<String>,
    },
    /// 管理板子别名（~/.rdk-sophon/config.toml）。
    #[command(subcommand)]
    Config(ConfigCmd),
}

#[derive(Debug, Subcommand)]
enum ConfigCmd {
    /// 列出所有别名与默认。
    List,
    /// 添加/更新一个别名。
    Add {
        /// 别名。
        name: String,
        /// 远程地址 ip:port。
        host: String,
        /// 超时秒（可选）。
        #[arg(long)]
        timeout: Option<u64>,
        /// 设为默认（不带 --board 时用）。
        #[arg(long)]
        default: bool,
    },
    /// 删除一个别名。
    Rm {
        /// 别名。
        name: String,
    },
    /// 显示配置文件路径。
    Path,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // config 子命令不连 daemon，直接操作配置文件后退出。
    if let Cmd::Config(sub) = &cli.cmd {
        return run_config(sub);
    }

    // 解析连接目标（host + timeout）。
    let (host, timeout_secs) = resolve_target(&cli)?;
    let timeout = Duration::from_secs(timeout_secs);
    let client = if let Some(h) = host {
        ClientBuilder::new().timeout(timeout).tcp(&h).await?
    } else {
        ClientBuilder::new().timeout(timeout).unix(&cli.socket).await?
    };

    match &cli.cmd {
        Cmd::Ping => print(&client, "ping", None, cli.raw).await?,
        Cmd::State => print(&client, "get_state", None, cli.raw).await?,
        Cmd::Thermal => print(&client, "get_thermal", None, cli.raw).await?,
        Cmd::Cpu => print(&client, "get_cpu", None, cli.raw).await?,
        Cmd::Memory => print(&client, "get_memory", None, cli.raw).await?,
        Cmd::Disk => print(&client, "get_disk", None, cli.raw).await?,
        Cmd::Net => print(&client, "get_net", None, cli.raw).await?,
        Cmd::Bpu => print(&client, "get_bpu", None, cli.raw).await?,
        Cmd::Refresh => print(&client, "refresh_state", None, cli.raw).await?,
        Cmd::Exec { cmd } => {
            let joined = cmd.join(" ");
            let mut map = serde_json::Map::new();
            map.insert("cmd".into(), serde_json::Value::String(joined));
            print(&client, "exec_shell", Some(Params::Named(map)), cli.raw).await?
        }
        Cmd::Raw { method, params } => {
            let p = match params {
                Some(s) => {
                    let v: serde_json::Value = serde_json::from_str(s)?;
                    Some(Params::Named(
                        v.as_object()
                            .cloned()
                            .ok_or_else(|| anyhow!("params 必须是 JSON 对象"))?,
                    ))
                }
                None => None,
            };
            print(&client, method, p, cli.raw).await?
        }
        Cmd::Config(_) => unreachable!("config 子命令已在上方处理"),
    }
    Ok(())
}

/// 解析连接目标。返回 (Option<host>, timeout_secs)。
/// 优先级：--host > --board 别名 > 配置 [default] > None（走本地 unix）。
/// env PROBE_HOST 已被 clap 注入到 cli.host，故 --host 与 env 同级。
fn resolve_target(cli: &Cli) -> Result<(Option<String>, u64)> {
    // 1) --host / PROBE_HOST（最高）
    if let Some(h) = &cli.host {
        return Ok((Some(h.clone()), cli.timeout));
    }
    let cfg = SophonConfig::load()?;
    // 2) --board 别名
    if let Some(name) = &cli.board {
        let b = cfg
            .board(name)
            .ok_or_else(|| anyhow!("别名 '{}' 在 {} 未找到", name, display_path()))?;
        let t = b.timeout.unwrap_or(cli.timeout);
        return Ok((Some(b.host.clone()), t));
    }
    // 3) 配置 [default]
    if let Some(d) = &cfg.default {
        let t = d.timeout.unwrap_or(cli.timeout);
        return Ok((Some(d.host.clone()), t));
    }
    // 4) 无远程地址，走本地 unix socket
    Ok((None, cli.timeout))
}

/// config 子命令：直接操作配置文件。
fn run_config(sub: &ConfigCmd) -> Result<()> {
    let path = SophonConfig::path()?;
    match sub {
        ConfigCmd::Path => {
            println!("{}", config::expand_home(&path));
            Ok(())
        }
        ConfigCmd::List => {
            let cfg = SophonConfig::load()?;
            println!("配置文件: {}", config::expand_home(&path));
            if let Some(d) = &cfg.default {
                println!("[default]  host={}  timeout={}", d.host, d.timeout.unwrap_or(30));
            } else {
                println!("[default]  （未设）");
            }
            if cfg.boards.is_empty() {
                println!("（无别名，用 sophonctl config add <name> <host> 添加）");
            } else {
                println!("别名:");
                for (name, b) in &cfg.boards {
                    let default_tag = cfg
                        .default
                        .as_ref()
                        .map(|d| d.host == b.host && d.timeout == b.timeout)
                        .unwrap_or(false);
                    println!(
                        "  {}{}  host={}  timeout={}",
                        name,
                        if default_tag { " (==default)" } else { "" },
                        b.host,
                        b.timeout.unwrap_or(30)
                    );
                }
            }
            Ok(())
        }
        ConfigCmd::Add { name, host, timeout, default } => {
            let mut cfg = SophonConfig::load()?;
            let board = config::BoardConfig {
                host: host.clone(),
                timeout: *timeout,
            };
            cfg.boards.insert(name.clone(), board);
            if *default {
                cfg.default = Some(config::BoardConfig {
                    host: host.clone(),
                    timeout: *timeout,
                });
            }
            cfg.save()?;
            println!("已保存别名 '{}' → {}", name, host);
            Ok(())
        }
        ConfigCmd::Rm { name } => {
            let mut cfg = SophonConfig::load()?;
            if cfg.boards.remove(name).is_some() {
                cfg.save()?;
                println!("已删除别名 '{}'", name);
                Ok(())
            } else {
                Err(anyhow!("别名 '{}' 不存在", name))
            }
        }
    }
}

fn display_path() -> String {
    config::expand_home(&SophonConfig::path().unwrap_or_default())
}

async fn print(client: &Client, method: &str, params: Option<Params>, raw: bool) -> Result<()> {
    let v = client.call(method, params).await?;
    if raw {
        println!("{}", v);
    } else {
        println!("{}", serde_json::to_string_pretty(&v)?);
    }
    Ok(())
}
