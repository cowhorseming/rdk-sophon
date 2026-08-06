# RESULTS — 模型侧全部结果一页看完

每个结果块都附:证据位置 + 一条本机可跑的核验命令 + 诚实边界。

## 1. SFT 效果:Base vs SFT(评测时 held-out、评测后公开的教师轨迹重放)

同一冻结 Test 前缀(49 任务/每臂 170 回合)、同一服务栈、temperature=0,双臂身份逐回合哈希锁定:

| 指标 | Base | SFT | Δ |
|---|---:|---:|---:|
| 严格工具调用一致(名称+参数) | 45/121 (37.19%) | **82/121 (67.77%)** | +30.58pp |
| 工具名称一致 | 48/121 (39.67%) | **93/121 (76.86%)** | +37.19pp |
| 工具参数一致 | 45/121 (37.19%) | **82/121 (67.77%)** | +30.58pp |
| 调用次数一致 | 81/121 (66.94%) | **97/121 (80.17%)** | +13.22pp |
| 最终回合干净收尾 | 44/49 (89.80%) | **48/49 (97.96%)** | +8.16pp |
| 全回合任务合同 | 0/49 (0.00%) | **15/49 (30.61%)** | +30.61pp |

配对视角:40 回合仅 SFT 对、3 回合仅 Base 对。提升不在"能否输出结构化调用"(两臂 94.2%/95.0%),而在**选对工具、给对参数**。代价:SFT 生成 tokens 与延迟约 2.1×(p50 10.4s→18.8s)。

```bash
cd benchmark/runs/model-ab-heldout113-20260805-v2
sha256sum -c SHA256SUMS
python3 ../../recompute_ab.py \
  --test ../../../data/releases/rdk-sft-v1-20260803/agentic/test.jsonl \
  arms/base.raw.jsonl arms/sft.raw.jsonl summary.json
```

边界:重放一致性 ≠ 端到端任务成功或物理效果;Test 在评测后公开用于复现,不能再作为未来无污染评测集;评测前缀为确定性有序前缀(28 curated 诊断 + 5 curated 受控动作 + 16 promoted 诊断),非随机抽样;final-text 严格相等两臂均 0,不宣称语义正确性。详见 [benchmark/runs/…/RESULTS.md](benchmark/runs/model-ab-heldout113-20260805-v2/RESULTS.md)。

## 2. 训练:QLoRA-SFT 收敛事实

单卡 AMD Radeon gfx1100(48GB),4-bit base + LoRA(r=8, α=16,67,108,864 可训练参数),1 epoch / 119 optimizer steps / 948 micro-windows。Phase 2 记录的 PyTorch 峰值为 37,633,069,056 allocated / 38,593,888,256 reserved bytes:

| checkpoint | validation mean CE |
|---|---:|
| step 0 | 1.1516 |
| step 119(发布) | **0.5937** |

```bash
cd examples/qwen3-32b-training && python3 verify_subset.py   # 精简训练树 + Test 哈希对账
```

边界:CE 下降证明拟合发生,Agent 能力提升由上面第 1 节的 A/B 回答;完整重训可选,因硬件/软件版本差异数值可能不同。

## 3. 部署身份:服务加载的就是训练产物

adapter `4dcee6914e3f9c61aeb33529208bf7e63f37c4c5ae5e0e37e7f7c6b3bfff20bf`(268,555,264 B)四方一致:训练冻结清单 = 训练机原件 = 本地备份 = ModelScope 平台侧哈希。服务 `/health` 报告 `checkpoint-000119`,加载后约 19.3GB VRAM;6 探针 diff 证明 adapter 行为生效(能力探针逐字一致、行为探针 3/3 差异)。

```bash
cat model/served-model-manifest.json   # 身份链 + 服务时间线 + 行为对比
# 有 Radeon 时:按 model/serving/README.md 起服务复现
```

边界:曾存在 base 服务以别名应答 SFT 模型名的时间窗(证据内如实记录);复核服务身份时应同时查看响应 `model` 字段与 `/health`,接入接口见 `model/serving/README.md`。

## 4. Radeon 推理优化:Qwen3-Next-80B 单卡部署(独立案例)

官方预量化 Q4_K_M(48.4GB)+ ROCm/HIP llama.cpp,单张 gfx1100;优化仅改 KV 精度(Q8→Q4)与 GPU offload 层数(45→47):

| 指标 | 基线 | 优化后 | 变化 |
|---|---:|---:|---:|
| Prefill(2,332 tok) | 1,271.45 tok/s | **1,397.39 tok/s** | +9.9% |
| Decode(64 tok) | 37.19 tok/s | **49.82 tok/s** | +34.0% |
| TTFT 中位 | 2,021.26 ms | **1,808.76 ms** | −10.5% |
| 平均墙钟延迟 | 3,727.88 ms | **3,084.19 ms** | −17.3% |

优化配置同时通过结构化 tool_calls、tool continuation 与 42,028-token needle 检索三个 canary。

```bash
cd radeon-optimization/qwen3-next-80b && python3 verify_results.py   # 重算全部十次测量与每个 delta
```

边界:该案例独立于 32B SFT 主线(非 demo 模型、非教师);校验的是保存的测量证据,不重跑推理;TTFT 仅存中位数,delta 可核、分布不可重建。

## 结果总述(一句话版)

> 在 Radeon 上:训练收敛(CE −48.4%)、产物身份四方哈希闭合、SFT 把严格工具调用一致率提升 30.6 个百分点(0→15 个任务满足全回合合同),另以独立案例证明 80B 级模型的单卡部署优化(decode +34%)。以上每个数字都可用本页命令离线重算。
