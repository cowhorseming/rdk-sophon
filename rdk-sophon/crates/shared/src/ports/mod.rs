//! ports 层：领域对外的纯 trait 抽象（端口）。
//!
//! 本 crate 只定义 trait 与关联错误类型，不包含任何实现。
//! 依赖方向：protocol → ports，下游（infra/collectors/domain/application）依赖 ports。
//! 采集器、读硬件、shell 执行都从这里抽象，便于在测试中注入假实现。

mod traits;
mod error;

pub use traits::{Collector, SysfsReader, ProcReader, HrutGateway, ShellRunner, ShellOutput};
pub use error::{PortError, ShellError};
