# rdk-agent

RDK 设备的多 Agent 编排服务预留目录。该项目未来会作为独立 TypeScript 应用与 `rdk-sophon` 同仓开发，并只通过系统中已安装的 `sophonctl` 与设备探针交互。

## 1. 分层

```text
src/
├── shared/       # 跨层类型与端口接口
├── domain/       # 任务领域模型与业务不变量
├── application/  # 用例编排
├── infra/        # sophonctl 等外部系统适配器
└── api/          # 进程/HTTP/CLI 等入口
```

依赖方向为 `api → application → domain/shared`；`infra` 实现 `shared` 中定义的端口。领域和应用层不得直接调用 `child_process` 或依赖 `sophonctl` 的参数格式。

## 2. 实现状态

当前目录只保留架构边界与分层约定，尚未创建 TypeScript 代码、Node.js 依赖或运行入口。

实现时，`infra` 应作为唯一可调用 `sophonctl` 的层；`application` 只依赖定义在 `shared` 中的探针端口接口。`exec` 等受控命令最终仍须受板端 `probe-daemon` 的 shell 策略约束。
