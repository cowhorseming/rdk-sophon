//! SessionService：单连接驱动。从原 daemon session.rs 移入 application 层。
//! tokio::select! 并发：读请求→dispatch→回发响应，同时把 broadcast 的 telemetry/alert
//! notification 转发给对端。dispatch 是 await，慢 shell 不会阻塞广播转发。

use std::sync::Arc;

use crate::audit::AuditLog;
use crate::rpc_dispatcher::{DispatchOutcome, RpcDispatcher};
use shared::protocol::JsonRpcMessage;
use tokio::sync::broadcast;
use infra::Transport;

/// 进程级 telemetry/alert 广播总线。daemon 装配时建一个，所有连接订阅。
#[derive(Clone)]
pub struct Broadcaster {
    tx: broadcast::Sender<JsonRpcMessage>,
}

impl Broadcaster {
    pub fn new(capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(capacity);
        Self { tx }
    }
    pub fn subscribe(&self) -> broadcast::Receiver<JsonRpcMessage> {
        self.tx.subscribe()
    }
    /// 发布一条消息给所有订阅者（无订阅者时丢弃）。
    pub fn publish(&self, msg: JsonRpcMessage) {
        let _ = self.tx.send(msg);
    }
}

/// 驱动一条连接直到 EOF 或致命错误。
pub async fn run_session(
    label: String,
    mut transport: Box<dyn Transport>,
    dispatcher: Arc<RpcDispatcher>,
    audit: AuditLog,
    mut bcast_rx: broadcast::Receiver<JsonRpcMessage>,
) {
    tracing::info!(%label, "session started");
    loop {
        tokio::select! {
            biased;
            // 优先转发广播（telemetry/alert），不让慢 shell 阻塞推送。
            recv_result = bcast_rx.recv() => {
                match recv_result {
                    Ok(msg) => {
                        if let Err(e) = transport.send(&msg).await {
                            tracing::warn!(%label, error=%e, "broadcast send failed");
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        // WS 出站等慢消费者可能 lag；重订阅继续，不静默丢。
                        tracing::warn!(%label, lagged = n, "broadcast lagged, resubscribing");
                    }
                }
            }
            // 读请求 → 分发 → 回发响应。
            res = transport.recv() => {
                match res {
                    Ok(Some(incoming)) => {
                        let outcome = dispatcher.dispatch(incoming, &label, &audit).await;
                        if let DispatchOutcome::Response(resp) = outcome {
                            if let Err(e) = transport.send(&resp).await {
                                tracing::warn!(%label, error=%e, "response send failed");
                                break;
                            }
                        }
                    }
                    Ok(None) => {
                        tracing::info!(%label, "peer closed");
                        break;
                    }
                    Err(e) => {
                        tracing::warn!(%label, error=%e, "recv error");
                        break;
                    }
                }
            }
        }
    }
    tracing::info!(%label, "session ended");
}
