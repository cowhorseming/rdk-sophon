# Tier 1 — 在 Radeon 上启动 SFT 服务并验证身份

评委路线:下载公开权重 → 一条命令起服务 → 健康检查 → 行为探针。约 20 分钟(不含下载)。

`qwen3_agentic_openai_server.py` 即正式评测所用的服务端**原件**(SHA-256 `95d5c139…`,与 `../deployment_manifest.orig.json` 及 A/B 评测的 expect 集绑定的是同一个哈希)。

## 1. 下载权重

```bash
# 基座(4-bit 预量化):
huggingface-cli download unsloth/Qwen3-32B-bnb-4bit --revision 7f721e74a6a8cc9ee352f7e49303a2c1705f9083 --local-dir base/
# adapter(即 demo 与 A/B 所用制品):
modelscope download ming01/Qwen3-32B-Agentic-SFT-r1-v3 --local_dir adapter/
sha256sum adapter/adapter_model.safetensors   # 必须 = 4dcee6914e3f9c61aeb33529208bf7e63f37c4c5ae5e0e37e7f7c6b3bfff20bf
```

## 2. 安装依赖并启动

实测环境:AMD Radeon gfx1100(约 19.3GB VRAM 占用)、ROCm 7.2.1、Python 3.12、torch 2.9.1+rocm7.2.0。

```bash
pip install torch --index-url https://download.pytorch.org/whl/rocm7.2
pip install -r requirements-serving.txt
echo "any-secret-token" > api_key
BASE_MODEL=./base ADAPTER=./adapter API_KEY_FILE=./api_key bash serve.sh
# 加载约 2 分钟,就绪日志:server ready at http://127.0.0.1:8000
```

## 3. 健康检查(必须显示 checkpoint 身份)

```bash
curl -s http://127.0.0.1:8000/health
# {"status":"ok","model":"Qwen3-32B-Agentic-SFT-r1-v3","checkpoint":"checkpoint-000119"}
```

## 4. 行为探针(可选,证明 adapter 生效)

```bash
python3 ../ab-probe/probe.py ./api_key probe-out.json
# 与 ../ab-probe/probe-sft-*.json 对照;若改起 base-only 服务(去掉 ADAPTER,serve.sh 会拒绝——
# 用 --model 直启不带 --adapter),输出应与 probe-base-*.json 一侧对齐
```

## Agent 接入接口

模型服务只暴露标准接口,不提供也不接管 `rdk-agent` 的配置:

- Base URL:`http://<radeon-host>:8000/v1`
- Endpoint:`POST /chat/completions`
- Model:`Qwen3-32B-Agentic-SFT-r1-v3`
- Authentication:`Authorization: Bearer <API_KEY>`

API Key 由 Radeon 主机上的 `API_KEY_FILE` 提供,真实 Key 不进入仓库。`rdk-agent` 的 provider、Base URL、模型名和 API Key 由使用者在 Agent 侧自行配置。
