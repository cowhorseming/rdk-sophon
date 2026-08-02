//! 端口层错误类型：硬件读取与 shell 执行的抽象错误。
//! 实现层（infra）把这些错误用 infra 层自己的 Exception 包装后再上抛。

use thiserror::Error;

/// 端口层通用错误：读硬件失败时的抽象。
#[derive(Debug, Error)]
pub enum PortError {
    #[error("io 错误: {0}")]
    Io(String),
    #[error("解析错误: {0}")]
    Parse(String),
}

/// shell 执行错误：超时、spawn 失败等。成功执行的"非零退出码"不是错误，而是 ShellOutput.exit。
#[derive(Debug, Error)]
pub enum ShellError {
    #[error("spawn 失败: {0}")]
    Spawn(String),
    #[error("命令超时（{secs} 秒）")]
    Timeout { secs: u64 },
    #[error("等待进程失败: {0}")]
    Wait(String),
}
