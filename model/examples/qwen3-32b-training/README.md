# Qwen3-32B Agentic LoRA-SFT 训练快照（精简公开版）

这里是 AMD 48GB 单卡正式训练所用**逐字节冻结代码**与**精选执行证据**的公开整理版。源目录 `train-model` 保持不动；本目录内每个文件的来源与 SHA-256 记录在 `source-manifest.json`，可用一条命令核对：

```bash
python3 verify_subset.py   # 纯标准库，无需 GPU / 权重 / 网络
```

## 训练结论（来自已验证的正式 run）

- 基础模型：`unsloth/Qwen3-32B-bnb-4bit@7f721e74a6a8cc9ee352f7e49303a2c1705f9083`
- 方法：4-bit base + LoRA-SFT（r=8, alpha=16，67,108,864 可训练参数），assistant-only shifted CE
- 1 epoch、119 optimizer steps、948 micro-windows、最大窗口 8192 tokens
- Phase 1 `PASS / RESTART_READY`（step 10），Phase 2 `PASS`（step 119）
- 最佳 validation：`checkpoint-000119`，mean CE 0.5936630333639499
- Controller 全程未见 OOM、cgroup memory event、采样缺口

证据落点：`evidence/launch/`（历史命令绑定）、`evidence/phase1-controller/` 与 `evidence/phase2-controller/`（门禁与资源结论）、`evidence/validations/`（0/30/60/90/119 五个曲线点）、`evidence/checkpoint-*/manifest.json`、`evidence/run-manifest.json`（冻结 run 合同）、`evidence/local-verification.json`（41 个冻结文件 + 12 个模型元数据文件的 SHA-256 总账）。

## 本目录与完整快照的关系

为控制体积，以下大文件**未随仓库分发**，其 SHA-256 全部记录在 `source-manifest.json` 的 `omitted` 条目中：

- `models/Qwen3-32B-bnb-4bit-7f721e74/` 的 tokenizer/vocab/merges 等元数据（可用 `tools/acquire_qwen3_32b_bnb.py` 按固定 revision 重新获取并逐文件校验）；
- 两份约 1MB 的 preflight `telemetry.jsonl`（保留了 `telemetry.head20.sample.jsonl` 头部样例）与 checkpoint `state.json`；
- 3.7MB 的 loss-window plan（可由 `tools/build_qwen3_32b_loss_window_plan_v2.py` 从冻结输入重建）。

`scripts/verify_bundle.py` 与 `tests/test_bundle_contract.py` 是完整快照的字节级验证器，原样保留；要跑通它们，需按 source-manifest 恢复省略文件并将数据放到源目录约定路径。日常核对请使用 `verify_subset.py`。

数据合同：held-out test（113 行）的逐字节副本在 `../../data/releases/rdk-sft-v1-20260803/agentic/`，`verify_subset.py` 会一并核对行数与 SHA-256;train/validation（946/116 行）已由 ModelScope 公开数据集承接，冻结原件哈希记录于 `source-manifest.json` 的 `data_release.removed_files`。

## 复现口径（评委须知）

**The released adapter is the artifact used by the demo and the A/B benchmark. Full retraining is optional and may produce numerically different results depending on hardware and software versions.**

复现所需的全部事实:基座 `unsloth/Qwen3-32B-bnb-4bit@7f721e74`;adapter 下载与哈希见 `../../model/README.md`;训练数据见 ModelScope 数据集(脱敏 train+validation);冻结训练代码与配置即本目录 `configs/`、`gates/`、`tools/`;历史训练为 119 optimizer steps、单卡 AMD Radeon gfx1100(48GB)、约 26.6GB 峰值 VRAM。示例启动命令(在源目录布局与已过门禁的环境下):

```bash
# 实际使用的启动形态:守护控制器包裹 trainer(CLI 契约与冻结代码逐字对应)
python3 configs/guarded_process_controller_v7.py --run-dir runs/<new-run> -- \
  python3 configs/qwen3_32b_agentic_formal_trainer_v2_cachebounded.py \
    --phase phase2 \
    --model models/Qwen3-32B-bnb-4bit-7f721e74 \
    --model-verification artifacts/model-acquisition/qwen3-32b-bnb-7f721e74-verification.json \
    --data-dir data/rdk-sft-v1-20260803-agentic \
    --original-plan artifacts/training-plan/qwen3-32b-agentic-train-plan-v1.json \
    --loss-plan artifacts/training-plan/qwen3-32b-agentic-loss-window-plan-v1.json \
    --common-script configs/qwen3_agentic_common.py \
    --run-dir runs/<new-run>/trainer --result runs/<new-run>/result.json
```

注意:controller 与 trainer 均 fail-closed 校验主机名/machine-id 等身份,换机器需按 RUNBOOK 重新过门禁;loss-window plan 可由 `tools/build_qwen3_32b_loss_window_plan_v2.py` 重建。

## 重要边界（公开表述请以此为准）

这是"已验证快照"，不是跨机器通用 trainer。正式代码 fail-closed 硬绑定原主机、GPU、`/workspace` 布局、数据与依赖哈希；换任何一项都必须生成新的验证清单并重新过门禁，不能沿用历史 PASS。冻结代码与证据中保留的原始绝对路径、主机标识是 provenance 的一部分，有意未改写——改写将破坏与 `evidence/local-verification.json` 的对账。训练完成也不等价于 Agentic 效果验收；held-out Test 与 A/B 评测是单独的质量门禁。运行合同详见 `docs/RUNBOOK.md`。
