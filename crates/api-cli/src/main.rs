//! probectl：本地 CLI 或远程客户端。本地走 Unix socket，远程走 TCP（--host）。
//! 复用 client::Client（与 HTTP 网关、WS 出站同源），与 daemon 走同一套 NDJSON 协议。

use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};
use client::{Client, ClientBuilder};
use shared::protocol::Params;
use std::time::Duration;

#[derive(Debug, Parser)]
#[command(name = "probectl", about = "操作 rdk-sophon 探针守护进程")]
struct Cli {
    /// 远程板子地址（ip:port）。不指定则走本地 Unix socket。
    #[arg(long, env = "PROBE_HOST")]
    host: Option<String>,
    /// 本地 daemon 的 Unix socket 路径。
    #[arg(short, long, default_value = "/run/probe-daemon/probe.sock", env = "PROBE_SOCK", global = true)]
    socket: String,
    /// 响应超时（秒）。
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
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let timeout = Duration::from_secs(cli.timeout);
    let client = if let Some(host) = &cli.host {
        ClientBuilder::new().timeout(timeout).tcp(host).await?
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
    }
    Ok(())
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
