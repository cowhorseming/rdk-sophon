> 中文版本：[../zh/MODEL_TRACK.md](../zh/MODEL_TRACK.md)

# Model Track — Trained, Deployed, and Optimized on AMD Radeon

This page is the index for the model-side contribution. Every number below is recomputable offline from the evidence in [`model/`](../../model/README.en.md); nothing here is a projection.

## What was done on Radeon

| Stage | Artifact | Hardware |
| --- | --- | --- |
| SFT training | LoRA `checkpoint-000119` on `unsloth/Qwen3-32B-bnb-4bit@7f721e74` | AMD Radeon gfx1100, ROCm, 119 optimizer steps |
| Deployment | OpenAI-compatible service, identity hash-bound to the trained adapter | same GPU |
| Inference optimization | Streaming/TTFT + lean LoRA decode path, on-device A/B | same GPU |

Adapter identity `4dcee6914e3f9c61aeb33529208bf7e63f37c4c5ae5e0e37e7f7c6b3bfff20bf` is identical across four independent sources (frozen training manifest, training host, local backup, ModelScope platform hash).

## Result 1 — the SFT model is measurably better

Base vs SFT, same frozen held-out Test, same service stack, temperature=0, model identity hash-locked per turn:

| Metric | Base | SFT |
| --- | ---: | ---: |
| Strict tool-call agreement (name + arguments) | 37.2% | **67.8%** |
| Tool-name agreement | 39.7% | **76.9%** |
| All-turn task contract | 0/49 | **15/49** |

Cost disclosed: SFT generates ≈2.1× the tokens and latency of Base.

## Result 2 — that difference decides whether a real task completes

The number above is agreement with frozen references. Put both models behind the real `rdk-agent` five-node workflow on a live RDK X5, change nothing but the model, and request the same capability (`wave-right-hand`):

| | Base | SFT |
| --- | --- | --- |
| Workflow nodes completed | 3 / 5 (60%) | **5 / 5 (100%)** |
| Outcome | stalled at CLI live acceptance; terminated after 14 min 25 s | **accepted** in 4 min 04 s |

Base did not crash. It returned a result the acceptance node could not parse — `Agent 的结构化结果无法解析` — which is precisely the capability the strict tool-call metric measures. The offline number is the mechanism behind the live outcome. Physical displacement is still left to human visual confirmation, and this is one task per arm rather than a sampled success rate; both limits are stated in [`model/AGENT_E2E.en.md`](../../model/AGENT_E2E.en.md).

## Result 3 — inference on that model, optimized on Radeon

Same base, same adapter, same GPU, temperature=0, 88 trials per arm. Baseline is the unmodified production inference path:

| Metric | Baseline | Optimized |
| --- | ---: | ---: |
| User-visible TTFT p50 | 17.41 s | **8.26 s** (2.11×) |
| User-visible TTFT p95 | 83.97 s | **12.89 s** (6.52×) |
| Decode | 6.54 tok/s | **6.72 tok/s** (+2.8%) |
| Output agreement vs baseline | — | **88/88 byte-identical** |

Two higher-ceiling candidates (merging LoRA into the NF4 base; `torch.compile` + StaticCache decode) were implemented, measured on the machine, and **rejected on evidence** — both are documented rather than hidden.

Environment: gfx1100, ROCm 7.2.1, torch 2.9.1+rocm7.2.0, transformers 5.5.0, peft 0.19.1, bitsandbytes 0.50.0.

## Reproduce

Without a GPU (about 5 minutes) — recompute the A/B table from the sealed raw records:

```bash
cd model/benchmark/runs/model-ab-heldout113-20260805-v2
sha256sum -c SHA256SUMS
python3 ../../recompute_ab.py \
  --test ../../../data/releases/rdk-sft-v1-20260803/agentic/test.jsonl \
  arms/base.raw.jsonl arms/sft.raw.jsonl summary.json
```

With a Radeon GPU — one command downloads the public weights, verifies the adapter hash fail-closed, and serves the model:

```bash
cd model/model/serving && bash deploy.sh      # DRY_RUN=1 verifies host and artifacts without starting anything
```

Re-run the inference A/B on that host:

```bash
cd model/radeon-optimization/qwen3-32b-agentic-sft
python3 benchmark.py --run-dir run-full       # regenerates results.json
```

## Evidence index

| Topic | Path |
| --- | --- |
| Model-side overview | [`model/README.en.md`](../../model/README.en.md) |
| All results on one page | [`model/RESULTS.en.md`](../../model/RESULTS.en.md) |
| Claim → evidence → hash map | [`model/EVIDENCE_MAP.en.md`](../../model/EVIDENCE_MAP.en.md) |
| Inference optimization code and A/B | [`model/radeon-optimization/qwen3-32b-agentic-sft/`](../../model/radeon-optimization/qwen3-32b-agentic-sft/README.md) |
| Deployment and identity verification | [`model/model/serving/README.en.md`](../../model/model/serving/README.en.md) |

## Boundaries

Replay agreement measures contract agreement with held-out teacher trajectories; it does not by itself prove end-to-end agent success or physical board execution. The Test set was released after evaluation for reproduction and must not be reused as a clean evaluation set. The inference optimization is validated by the A/B above but is not yet wired into the live serving path. The separate Qwen3-Next-80B single-GPU case study in `model/radeon-optimization/qwen3-next-80b/` is an off-the-shelf model, not this team's trained model.
