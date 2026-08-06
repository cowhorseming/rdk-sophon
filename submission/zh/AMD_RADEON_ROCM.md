# AMD Radeon 与 ROCm 部署及优化指南

## 合规目标

赛道 2 的目标推理链路，是在参赛者控制的 Radeon Cloud 上运行专用 vLLM 服务。模型进程应在该 AMD Radeon GPU 实例上通过 ROCm 运行；`rdk-agent` 通过 OpenAI-compatible 服务边界访问它。共享的公共模型 API 不得成为唯一的核心推理链路。服务器侧证明仍为证据待补（Evidence pending），具体项目列于下文。

## 当前客户端配置

私有开发环境当前选择：

| 字段 | 值 |
| --- | --- |
| Pi provider | `amd` |
| 模型 | `Qwen3-Next-80B-A3B-Instruct` |
| API 形式 | OpenAI-compatible Chat Completions |
| 声明的上下文窗口 | 131,072 tokens |
| 声明的最大输出 | 8,192 tokens |

端点和 API key 被有意排除。公开示例通过环境变量读取密钥：[pi-models.amd-rocm.example.json](config/pi-models.amd-rocm.example.json)。

该客户端配置只能证明模型路由，不能证明 GPU 型号、ROCm 版本、服务后端或量化方式。

## 最终提交前必须补充的服务器证据

采集并脱敏：

1. `rocm-smi` 输出的 GPU 产品与驱动信息。
2. `rocminfo` 和 PyTorch 输出的 ROCm/HIP 版本。
3. vLLM 版本及确切启动命令。
4. 模型仓库/revision 和 served model name。
5. 精度或量化配置。
6. 本地 `/v1/models` 响应。
7. 能体现参赛者控制 Radeon Cloud 实例、且不含凭据的截图。

## 已实现的软件层推理控制

- 确定性的问候/确认回复旁路。
- 采用不启用工具、不加载 Skill、无上下文的小型意图分类会话。
- 各阶段使用聚焦会话，避免单个会话无限增长。
- 严格加载 Skill，并提供明确的选择证据。
- 文本交接限制在 6,000 个字符以内。
- 在模型外执行确定性的结构与安全检查。
- 以文件作为各阶段之间持久化的事实来源。

这些特性可以减少不必要的 token 消耗和上下文增长，但不能替代经测量的 GPU 优化。

## 受控优化矩阵

保持提示词、输出上限、软件 revision 和正确性标准不变；每次只改变一个变量。

| 实验 | 基线 | 候选配置 | 所需证据 |
| --- | --- | --- | --- |
| 精度/量化 | 服务器默认值 | 硬件支持的较低精度或量化模型 | 确切启动参数、VRAM、正确性、TTFT、tokens/s |
| 上下文上限 | 支持的最大值 | 限制为工作流实测所需大小 | 输入 token 数、截断检查、延迟、VRAM |
| 模型预热 | 冷进程 | 采用有记录预热流程的热进程 | 冷/热样本、p50/p95 |
| 内存利用率 | 服务器默认值 | 调优后的 vLLM 利用率 | 多次运行无 OOM、峰值 VRAM |
| 并发度 | 单请求 | 经测量的低并发 | 单请求延迟与吞吐量 |
| 提示词负载 | 完整通用上下文 | 限定智能体 + 已选 Skill | token 数、阶段正确性、端到端时间 |

## 指标

- 客户端首 token 时间（TTFT）的 p50 和 p95。
- 解码输出速度（tokens/s）。
- 请求总延迟。
- 端到端工作流耗时。
- 峰值 VRAM 与 GPU 利用率。
- 仅当目标环境提供可靠计数器时，记录功率或能耗。
- 使用相同提示词时的正确响应率与验收通过率。

## 基准测试命令

```sh
node submission/zh/scripts/benchmark-openai-compatible.mjs \
  --provider amd \
  --runs 10 \
  --output submission/zh/evidence/amd-endpoint-benchmark.json
```

为便于追踪，报告包含端点 host，但不包含 scheme、path 或 key。如果 host 也会暴露私有基础设施，请将其删除或哈希化。

## 证据表

| 项目 | 状态 |
| --- | --- |
| 客户端 provider/model 选择 | 已在本地验证；本提交中已脱敏 |
| AMD Radeon GPU 型号 | 证据待补（Evidence pending） |
| ROCm 版本 | 证据待补（Evidence pending） |
| 专用 vLLM 服务器版本/配置 | 证据待补（Evidence pending） |
| 模型精度/量化 | 证据待补（Evidence pending） |
| 基线与优化后 TTFT | 证据待补（Evidence pending） |
| 基线与优化后解码吞吐量 | 证据待补（Evidence pending） |
| 峰值 VRAM/利用率 | 证据待补（Evidence pending） |
| 智能体工作流端到端延迟 | 证据待补（Evidence pending） |

任何未经测量的项目都不得从 `Evidence pending` 改为具体数值。
