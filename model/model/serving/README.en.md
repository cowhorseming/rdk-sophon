> Chinese version: [README.md](README.md)

# Tier 1 — Start the SFT Service on Radeon and Verify Its Identity

Judge path: download the public weights → start the service with one command → run the health check → run the behavioral probe. Approximately 20 minutes, excluding download time.

`qwen3_agentic_openai_server.py` is the **original server artifact** used for the formal evaluation (SHA-256 `95d5c139…`; it is the same hash bound by `../deployment_manifest.orig.json` and the A/B evaluator's expect set).

## 1. Download the weights

```bash
# Base (4-bit pre-quantized):
huggingface-cli download unsloth/Qwen3-32B-bnb-4bit --revision 7f721e74a6a8cc9ee352f7e49303a2c1705f9083 --local-dir base/
# Adapter (the artifact used by both the demo and the A/B):
modelscope download ming01/Qwen3-32B-Agentic-SFT-r1-v3 --local_dir adapter/
sha256sum adapter/adapter_model.safetensors   # Must equal 4dcee6914e3f9c61aeb33529208bf7e63f37c4c5ae5e0e37e7f7c6b3bfff20bf
```

## 2. Install dependencies and start the service

Measured environment: AMD Radeon gfx1100 (approximately 19.3GB VRAM in use), ROCm 7.2.1, Python 3.12, and torch 2.9.1+rocm7.2.0.

```bash
pip install torch --index-url https://download.pytorch.org/whl/rocm7.2
pip install -r requirements-serving.txt
echo "any-secret-token" > api_key
BASE_MODEL=./base ADAPTER=./adapter API_KEY_FILE=./api_key bash serve.sh
# Loading takes approximately 2 minutes; ready log:server ready at http://127.0.0.1:8000
```

## 3. Health check (must show checkpoint identity)

```bash
curl -s http://127.0.0.1:8000/health
# {"status":"ok","model":"Qwen3-32B-Agentic-SFT-r1-v3","checkpoint":"checkpoint-000119"}
```

## 4. Behavioral probe (optional; proves that the adapter took effect)

```bash
python3 ../ab-probe/probe.py ./api_key probe-out.json
# Compare with ../ab-probe/probe-sft-*.json. To start a base-only service (serve.sh rejects a missing ADAPTER),
# invoke the server directly with --model and without --adapter; the output should align with the probe-base-*.json side.
```

## Agent integration interface

The model service exposes only standard interfaces and neither provides nor takes over `rdk-agent` configuration:

- Base URL: `http://<radeon-host>:8000/v1`
- Endpoint: `POST /chat/completions`
- Model: `Qwen3-32B-Agentic-SFT-r1-v3`
- Authentication: `Authorization: Bearer <API_KEY>`

The API Key is supplied by `API_KEY_FILE` on the Radeon host; the real Key is never stored in the repository. The user configures the `rdk-agent` provider, Base URL, model name, and API Key on the Agent side.
