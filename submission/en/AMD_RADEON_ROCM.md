# AMD Radeon and ROCm Deployment and Optimization

## Compliance objective

The Track 2 target inference path is a participant-controlled dedicated vLLM service on Radeon Cloud. The model process is intended to run on that AMD Radeon GPU instance with ROCm; `rdk-agent` reaches it through an OpenAI-compatible service boundary. A shared public model API must not be the only core inference path. Server-side proof remains pending and is listed below.

## Current client configuration

The private development environment currently selects:

| Field | Value |
| --- | --- |
| Pi provider | `amd` |
| Model | `Qwen3-Next-80B-A3B-Instruct` |
| API shape | OpenAI-compatible Chat Completions |
| Declared context window | 131,072 tokens |
| Declared maximum output | 8,192 tokens |

The endpoint and API key are intentionally excluded. The public example uses an environment variable: [pi-models.amd-rocm.example.json](config/pi-models.amd-rocm.example.json).

This client configuration proves only model routing. It does not prove GPU type, ROCm version, serving backend, or quantization.

## Server evidence required before final submission

Capture and redact:

1. `rocm-smi` GPU product and driver output.
2. ROCm/HIP version from `rocminfo` and PyTorch.
3. vLLM version and exact launch command.
4. Model repository/revision and served model name.
5. Precision or quantization configuration.
6. Local `/v1/models` response.
7. A screenshot showing the participant-controlled Radeon Cloud instance without credentials.

## Implemented software-level inference controls

- Deterministic greeting/acknowledgement bypass.
- A small, no-tool, no-Skill, no-context intent-classification session.
- Focused per-stage sessions instead of one unbounded conversation.
- Strict Skill loading and explicit selection evidence.
- Text handoffs bounded to 6,000 characters.
- Deterministic structural/safety checks outside the model.
- Files as the durable source of truth between stages.

These features reduce unnecessary tokens and context growth. They are not substitutes for measured GPU optimization.

## Controlled optimization matrix

Hold prompts, output limits, software revision, and correctness criteria constant. Change one variable at a time.

| Experiment | Baseline | Candidate | Required evidence |
| --- | --- | --- | --- |
| Precision/quantization | Server default | Hardware-supported lower precision or quantized model | Exact launch flags, VRAM, correctness, TTFT, tokens/s |
| Context limit | Maximum supported | Bounded to measured workflow needs | Input tokens, truncation checks, latency, VRAM |
| Warm model | Cold process | Warm process with documented warm-up | Cold/warm samples, p50/p95 |
| Memory utilization | Server default | Tuned vLLM utilization | OOM-free repeated runs, peak VRAM |
| Concurrency | One request | Measured low concurrency | Per-request latency and throughput |
| Prompt workload | Full generic context | Scoped agent + selected Skill | Token counts, stage correctness, end-to-end time |

## Metrics

- Client time to first token (TTFT), p50 and p95.
- Decode output tokens per second.
- Total request latency.
- End-to-end workflow time.
- Peak VRAM and GPU utilization.
- Power or energy only where the target exposes reliable counters.
- Correct-response and acceptance rate under the same prompts.

## Benchmark command

```sh
node submission/en/scripts/benchmark-openai-compatible.mjs \
  --provider amd \
  --runs 10 \
  --output submission/en/evidence/amd-endpoint-benchmark.json
```

The report contains the endpoint host for traceability but no scheme, path, or key. Remove or hash the host as well if it reveals private infrastructure.

## Evidence table

| Item | Status |
| --- | --- |
| Client provider/model selection | Verified locally; sanitized in this submission |
| AMD Radeon GPU model | Evidence pending |
| ROCm version | Evidence pending |
| Dedicated vLLM server version/configuration | Evidence pending |
| Model precision/quantization | Evidence pending |
| Baseline and tuned TTFT | Evidence pending |
| Baseline and tuned decode throughput | Evidence pending |
| Peak VRAM/utilization | Evidence pending |
| End-to-end agent workflow latency | Evidence pending |

No unmeasured value should be changed from `Evidence pending` to a number.
