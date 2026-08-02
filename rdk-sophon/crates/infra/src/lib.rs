//! infra 基础设施层：实现 shared::ports 定义的 trait，以及传输适配器。
//!
//! 包含两个子模块：
//! - `transport`：Transport trait + NDJSON 帧 + TCP/Unix/Serial/Stub 适配器。
//! - 顶层实现：sysfs/proc/hrut 读硬件、statvfs FFI、shell 执行（RealShellRunner）。
//!
//! 所有实现都是 best-effort：单个读取失败返回 None/Err，不 panic，不拖垮 daemon。

pub mod transport;

mod sysfs;
mod proc;
mod hrut;
mod statvfs;
mod shell;

pub use sysfs::RealSysfsReader;
pub use proc::RealProcReader;
pub use hrut::RealHrutGateway;
pub use statvfs::{StatvfsResult, statvfs_of};
pub use shell::RealShellRunner;

// 传输层便捷重导出，让下游可直接 `use infra::Transport` 等。
pub use transport::{Transport, TransportError, FramedReader, FramedWriter, FrameError,
                    TcpTransport, UnixTransport, SerialTransport, StubTransport};
