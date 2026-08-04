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

## 2. 当前实现：TUI 编排器

本目录提供一个基于 [Pi SDK](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 和 `@earendil-works/pi-tui` 的终端编排器，当前包含两种模式：

1. **机器人开发模式**：依次完成 Python、sophonctl CLI、Skill 三个 TDD 小循环。每个循环由测试设计、Coding、独立验证三个 Agent 组成；验证要求返工时自动进入下一轮。各循环通过后由专用 Agent 部署 Python、CLI、Skill，最后分别执行 CLI 和 Skill 自然语言真机验收。
2. **机器人应用模式**：单 Agent 根据自然语言选择一个或多个已交付 Skill；动作式请求会在前置检查后直接执行一次对应的真实机器人动作，查询式请求保持只读。

任意 Agent 无法继续或自动返工达到上限时，工作流暂停并请求人类输入；输入 `/abort` 可以终止。当前不设置人工审批门，正常交付步骤自动继续。

每个 Agent 有独立的系统提示词、工具白名单、写路径白名单、阶段超时、执行沙箱和严格 Skill 白名单；当前不限制工具调用次数。普通开发者直接运行 `rdk-agent`，程序会从 `config/templates/magicbox-servo` 初始化版本化托管工程，无需下载 rdk-sophon 源码。Python、CLI、Skill 的开发测试命令默认在离线 Podman Python 3.12 容器中执行，托管工作区只读挂载，代码修改仍由受 `writePaths` 约束的 Pi 文件工具完成。部署和真机验收留在宿主机执行。Pi 不会向该 Agent 暴露白名单之外的全局或项目 Skill；Agent 根据 Skill 的名称和描述匹配用户需求，先读取一个或多个对应 `SKILL.md` 再执行。机器人应用模式会在工具层区分查询和动作：查询只允许 sophonctl 列表、帮助及版本检查，其他 Bash 命令在启动前拒绝；动作式请求才开放一次真实动作。验证 Agent 只有实际运行安全测试且 Bash 没有报错时才能通过；Skill 交付还会经过确定性合同校验，错误命令、虚假参数或测试结论会被强制改为返工。工作区来源、模式、TDD 循环、部署、最终验收和最大返工次数全部来自运行时读取的 [`config/agents.yaml`](config/agents.yaml)，Skill 位于 `config/skills/<name>/SKILL.md`。

Pi SDK 本身没有内置安全沙箱；它提供可替换工具接口和容器/VM 示例。rdk-agent 通过该接口把开发阶段 Bash 路由到 Podman。首次使用研发模式前准备固定镜像：

```sh
podman machine start
podman pull docker.io/library/python:3.12-slim
```

```sh
cd /Users/d-robotics/Documents/project/rdk-sophon/rdk-agent
# Pi SDK 要求 Node.js >= 22.19.0
node --version
npm install --ignore-scripts
npm run start
```

部署到用户目录并注册全局命令：

```sh
npm run deploy
rdk-agent
```

默认托管工程位于 `~/.local/state/rdk-agent/workspaces/magicbox-servo/v2`，由内置模板首次原子初始化，重复启动不会覆盖已开发代码。`/workspace` 可查看当前工程和来源。模板升级通过提高 `workspace.version` 创建新版本目录，避免覆盖旧工程。

开发阶段的 Python/CLI/Skill 测试在离线 Podman 容器中执行。运行时只依赖 Python 3.12 标准库，测试统一使用 `unittest`；不使用 pytest，不会在任务中联网安装包。模板自带 GPIO mock 参考测试，供测试 Agent 按现有项目规范扩展。

只有参与 rdk-sophon 仓库开发时才需要显式指定外部源码：

```sh
rdk-agent --workspace /path/to/rdk-sophon
```

外部工程模式会检查 `workspace.requiredPaths`；传错目录时在创建 Agent 前中止并提示候选项目。

默认安装到 `~/.local/share/rdk-agent`，命令链接安装到 `~/.local/bin/rdk-agent`。部署脚本首次运行时还会初始化 `~/.config/rdk-agent`；未修改的默认配置会随程序升级，检测到用户自定义后则保留原配置并生成新版示例供手动合并。

直接编辑下面这些位置，下次启动 TUI 即可生效，不需要修改、编译或重新部署代码：

```text
~/.config/rdk-agent/
├── agents.yaml                 # 模式、循环、Agent 提示词、工具和 Skill
├── skills/<name>/SKILL.md      # Skill 正文
└── templates/magicbox-servo/   # 普通开发者的初始指令工程
```

也可以临时加载另一套配置：

```sh
rdk-agent --config-dir /path/to/config
```

部署目录可通过 `npm run deploy -- --install-dir <dir> --bin-dir <dir> --config-dir <dir>` 覆盖；脚本会先在临时目录安装生产依赖，成功后再替换旧版本。

TUI 命令：

```text
Shift+Tab                    同时按下，循环切换模式
/workspace                   查看托管/外部工作区及其来源
/skills                      查看当前 Agent 配置、实际加载和本次选择的 Skill
/modes                       查看模式
/mode robot-development      切换机器人开发模式
/mode robot-application      切换机器人应用模式
/clear                       清空日志
/abort                       在等待人类接入时终止工作流
/quit                        退出
```

TUI 默认进入机器人应用模式。模式只能在工作流空闲时切换。

页面和运行日志会实时输出 Skill 白名单、实际加载列表和本次选择，同时展示实际模型、推理级别、循环次数、Agent 状态、工具调用和人类接入请求。Pi 使用其已配置的模型和认证（通常来自 `~/.pi/agent`）。

```text
src/
├── shared/       # AgentRunner 端口、跨层事件
├── domain/       # Agent 配置模型与不可跳过的交付工作流状态机
├── application/  # 双模式编排、TDD 循环和 Human-in-the-loop
├── infra/        # Pi SDK 适配器（唯一知道 Pi session 的层）
└── api/tui/      # Pi TUI 的交互入口和可视化
```

`infra` 仍是未来唯一可调用 `sophonctl` 的层；当前 TUI 中的 Agent 通过 Pi 的受限工具集在目标工作目录中完成交付。`exec` 等受控命令最终仍须受板端 `probe-daemon` 的 shell 策略约束。
