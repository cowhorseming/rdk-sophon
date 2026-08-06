# RDK Agent

[English](README.md) | [简体中文](README.zh-CN.md)

> From natural-language requirements to governed robot capabilities on RDK X5.

RDK Agent is a privately deployed, multi-agent platform for developing and operating robot capabilities on an RDK X5. State and device control remain local; model inference can use a participant-controlled private endpoint. A developer describes a robot behavior in natural language, and specialized agents transform it into a tested, validated, deployable, and reusable capability.

![RDK Agent concept cover](submission/en/assets/rdk-agent-hero.png)

> The cover is a project-created conceptual illustration, not a photograph of the submitted hardware.

This English README is the authoritative competition-facing description for the AMD AI DevMaster Track 2 submission. The [Chinese README](README.zh-CN.md) is a localized reference for team review, presentation, and demo preparation; it does not replace the English competition copy.

## Track 2 submission at a glance

| Field | Value |
| --- | --- |
| Track | Track 2 - Development and Local Deployment of Private AI Agents |
| Application | RDK Agent |
| Team / participant | `<TEAM OR PARTICIPANT NAME>` |
| Source repository | <https://github.com/cowhorseming/rdk-sophon> |
| Demo video | `<DEMO VIDEO URL>` |
| PR title | `Track 2, <TEAM OR PARTICIPANT NAME>, RDK Agent` |
| Official deadline | 2026-08-06 23:59 Beijing/Singapore time (UTC+8) |

Current delivery status:

| Requirement | Status | Evidence or attachment |
| --- | --- | --- |
| Project specification | Complete | This README and the [12-page PDF](submission/en/deliverables/RDK_Agent_Project_Specification.pdf) |
| Complete source and README | Complete | This monorepo; subsystem details are in the [`rdk-agent` README](rdk-agent/README.md) and [`rdk-sophon` README](rdk-sophon/README.md) |
| Demo video, 3-5 minutes | Recorded; public URL pending | URL placeholder and final review list are included below |
| Supplementary presentation | Complete | [12-slide PowerPoint deck](submission/en/deliverables/RDK_Agent_Track2_Pitch_Deck.pptx) |
| AMD Radeon/ROCm deployment and optimization plan | Complete | Configuration, controlled experiments, metrics, and benchmark procedure are included below |
| AMD server and performance proof | Complete for the trained model; **pending for the 80B agent backend** | Model side: [model track index](submission/en/MODEL_TRACK.md) — gfx1100, ROCm 7.2.1, adapter hash, and baseline-versus-optimized A/B, all recomputable offline. Agent backend side: vLLM host, model revision, and precision still to be attached |
| Verification evidence | Captured on 2026-08-05 | [Raw verification record](submission/en/evidence/verification-2026-08-05.md) |

Before final submission, the participant must provide:

1. The exact registered team name or participant name.
2. A public URL for the already recorded 3-5 minute demo, verified from a signed-out browser.
3. Redacted, reproducible Radeon GPU, ROCm, vLLM, model revision, precision/quantization, and benchmark evidence from the participant-controlled instance.
4. A final review of the worktree and explicit approval before commit and publication.

## Executive summary

RDK Agent is a private multi-agent development and operation platform for RDK robots. A developer describes a behavior in natural language. Specialized agents then design tests, implement only the bounded action entry point, verify executable evidence, construct a deterministic release, deploy it to the board, install it as a reusable Skill, and perform controlled CLI and natural-language acceptance checks. The submitted action-package path currently targets parameterless `rdk-servo-action/v1` actions for the MagicBox servo runtime.

The project addresses a concrete robotics problem: even a small behavior crosses natural-language intent, Python hardware logic, tests, command-line integration, remote deployment, Skill metadata, and physical verification. Manual handoffs are difficult to reproduce, while a general-purpose coding agent needs stronger controls before it can interact with real hardware.

RDK Agent separates model-driven reasoning from deterministic delivery and device execution. Agents work within tool, Skill, filesystem, timeout, and sandbox boundaries. Deterministic scripts control scaffolding, validation, release structure, hashes, and atomic deployment. The RDK X5 exposes a stable control and telemetry contract through `sophonctl` and `probe-daemon`.

The repository contains two independently buildable and deployable systems:

| Directory | Stack | Responsibility |
| --- | --- | --- |
| `rdk-agent/` | TypeScript, Pi SDK | TUI/headless application, intent routing, multi-agent TDD, scoped tools, Skill selection and installation, deterministic delivery adapters, deployment, and human-in-the-loop recovery. |
| `rdk-sophon/` | Rust | RDK X5 `probe-daemon`, `sophonctl`, hardware-state collection, JSON-RPC, telemetry, alerts, command policy and audit, transports, and dynamic plugins. |

The two subprojects share no Cargo or npm workspace and no internal code dependency. Their integration contract is the `sophonctl` CLI and the board-side JSON-RPC protocol, so either directory can later move to an independent repository without changing the other system's architecture.

## Why “Sophon”? - The naming story

The board-side subsystem `rdk-sophon` takes its name from the sophon (智子) in *The Three-Body Problem*. In the novel, an extraordinarily advanced messenger is sent across space to Earth, where it can observe human activity and sustain communication with its origin.

This project deliberately reinterprets that science-fiction idea as transparent, owner-controlled engineering:

| Literary metaphor | `rdk-sophon` implementation |
| --- | --- |
| A messenger is sent to a distant world | `probe-daemon` is deployed to the RDK X5 board. |
| It observes local conditions | Collectors read temperature, CPU, memory, disk, network, and BPU state. |
| It reports across a long communication link | Telemetry and JSON-RPC carry board state to development-host clients. |
| It mediates communication with the distant system | `sophonctl` connects `rdk-agent` to board-side plugins and capabilities. |
| It can influence events remotely | Governed commands can invoke an approved robot capability. |

The ethical and operational direction is intentionally different from covert fictional surveillance: `rdk-sophon` is installed by the device owner, exposes explicit interfaces, keeps an audit trail, applies command policy, and restricts agent permissions.

![Original science-fiction interpretation of the Sophon naming metaphor](submission/en/assets/sophon-three-body-concept.png)

> This is a project-created AI-generated conceptual illustration. No official artwork or assets from the novel or its adaptations are used. The name is a literary allusion used only to explain an internal code name. This independent project is not endorsed by or affiliated with the work's author, publishers, rights holders, or screen adaptations.

## Target users and application scenarios

### Robot application developers

A developer can request a new self-contained robot action without manually coordinating test files, control code, plugin registration, Skill documentation, deployment, and acceptance.

Example:

```text
Create a new action that moves its left side once.
```

The system preserves the original request throughout the workflow. If generated metadata, paths, or hardware calls reverse the requested side, a deterministic guard rejects the change before it is written.

### Robotics educators and prototype teams

The visible Test -> Code -> Verify loop makes agentic robot development inspectable. Offline tests use fakes and mocks; the model does not need direct GPIO access to develop a capability.

### RDK X5 operators

The same platform provides read-only inspection for temperature, CPU, memory, disk, network, BPU, and dynamic plugins. It distinguishes a successful command path from human confirmation that physical motion was correct.

### Reusable private robot capabilities

Validated capabilities become local Skills. Robot Application Mode can select an installed Skill from natural language and execute one mapped action without reopening the development workflow.

## System architecture

![End-to-end architecture](submission/en/assets/architecture.png)

```text
Development host                                           RDK X5

User -> RDK Agent TUI / headless runner
          |-- intent gate
          |-- Action Package TDD: test -> code -> verify
          |-- deterministic build and deployment tools
          |-- offline Podman test sandbox
          `-- generated Skills
                    |
                 sophonctl -------- TCP 7777 --------> probe-daemon
                                                        |-- hardware collectors
                                                        |-- telemetry and alerts
                                                        `-- servo plugin -> action packages

RDK Agent -> private OpenAI-compatible endpoint -> vLLM -> ROCm -> AMD Radeon GPU
```

| Component | Responsibility |
| --- | --- |
| `rdk-agent` | TypeScript TUI/headless application, intent routing, multi-agent orchestration, scoped tools, Skill selection, deterministic delivery adapters, and human-in-the-loop handling. |
| `sophonctl` | Stable development-host command contract for board state, plugins, and actions. |
| `probe-daemon` | Rust service on RDK X5 for RPC dispatch, state collection, telemetry, alerting, command policy, audit, and dynamic plugins. |
| Servo plugin and action packages | Board-side Python capability runtime with local metadata and independently removable action packages. |
| Private model server | OpenAI-compatible inference endpoint on a participant-controlled AMD Radeon Cloud instance with ROCm; selected through Pi configuration rather than application code. |

`rdk-agent` does not link against the Rust crates. It invokes the installed `sophonctl` client, which communicates with `probe-daemon` over TCP port 7777. Model inference proposes bounded work; deterministic tools and the board contract govern what is written or executed. Model selection is isolated behind the Pi SDK session adapter, so a private OpenAI-compatible server can replace another provider without changing workflow or device code.

## Agent architecture and workflow

![Five-node development workflow](submission/en/assets/workflow.png)

### Intent gate

Exact greetings and acknowledgements are answered deterministically. Other development input is classified in a short model session with no tools, Skills, project context, or filesystem writes. Only a high-confidence request inside the supported action-package scope starts development. `/develop` is an explicit human override.

### Action Package TDD

The bounded TDD loop has three specialized roles:

1. **Action Test Design Agent** creates or revises behavior tests and action metadata.
2. **Action Coding Agent** implements only the action entry point.
3. **Action Verification Agent** independently runs contract and behavior checks without write access.

Failed verification restarts the full Test -> Code -> Verify loop. After three unsuccessful iterations, the workflow pauses for human guidance rather than silently continuing.

### Deterministic delivery

After verification, four ordered delivery stages run:

1. **Board Release Deployment Agent** calls deterministic build tooling and atomically publishes the release.
2. **Skill Installation Agent** installs the generated runtime Skill on the development host.
3. **CLI Hardware Acceptance Agent** executes the new capability once through `sophonctl`.
4. **Natural-Language Skill Acceptance Agent** selects the installed Skill using the original request and executes the same capability once.

The five visible development nodes are therefore:

1. Action Package TDD: Test Agent -> Coding Agent -> Verification Agent.
2. Board Release Deployment.
3. Development-host Skill Installation.
4. CLI Hardware Acceptance.
5. Natural-Language Skill Acceptance.

### Robot Application Mode

Application Mode has a separate single-agent path. Capability questions remain read-only. An imperative request authorizes one mapped action. The tool layer enforces this distinction even if model text is incorrect.

## Core capabilities and Track 2 fit

- Tool calling through stage-specific, bounded operations such as scaffold, validate, build, and deploy.
- Multi-step planning through ordered handoffs from intent routing to TDD, release, deployment, Skill installation, and two acceptance paths.
- Per-agent tool, Skill, write-path, timeout, and sandbox boundaries.
- Human-in-the-loop recovery for ambiguity, invalid results, tool errors, and exhausted revision budgets; `/abort` stops a blocked run.
- Offline, network-disabled Podman tests with a read-only workspace and resource limits; credentials and host home directories are not mounted.
- Deterministic left/right consistency checks before mutation.
- Executable-evidence gates that reject unsupported claims of successful verification.
- Atomic board deployment with staged validation, backup, and rollback.
- RDK X5 collection for temperature, CPU, memory, disk, network, and BPU state.
- Dynamic action packages discoverable and removable without recompiling the Rust CLI.

The Track 2 rules list five agent capabilities and require at least two. This project claims only capabilities implemented in the repository:

| Track capability | Status | Evidence boundary |
| --- | --- | --- |
| Local RAG | Not implemented | Not claimed. |
| Tool calling | Implemented | Scoped read/bash/write/edit plus deterministic action-package and deployment tools. |
| Multi-step planning | Implemented | Ordered domain workflow with bounded TDD revision. |
| Local multi-turn memory | Partial | In-memory sessions and human follow-up exist; persistent cross-run memory is not implemented and is not counted. |
| Permission/privacy mechanism | Implemented at the agent/tool layer | Allowlists, offline sandbox, read-only mounts, evidence gates, and explicit action/query separation. Transport authentication and normal-path per-action approval remain roadmap items. |

## Safety and reliability design

### Safety below the prompt layer

Prompt instructions are not the only control. File tools validate paths, Bash rejects file mutation and unsafe command forms, action-package tooling validates structure and semantics, and hardware actions are unavailable to development agents.

### Direction-consistency guard

When the original request explicitly identifies left, right, or both sides, the action ID, metadata, intent examples, directory, and Python bridge calls must agree. Conflicts fail with stable code `ACTION-DIRECTION-001` before mutation.

### Executable evidence gate

A textual `passed` result is insufficient. The runner records whether the Verification Agent actually executed Bash and whether the final check succeeded. Missing or failed evidence changes the result to revision.

### Deterministic contract validation

The action-package format rejects imports, dynamic execution, private controller access, runtime parameters, asynchronous entry points, and coupling to test-spy fields. Release structure and metadata are generated by scripts rather than free-form model output.

### Atomic deployment

Deployment uploads to staging, validates files and hashes, takes a backup, replaces the target, and restores the backup when a post-swap step fails.

### Honest physical acceptance

Automated checks prove the command path and software contract. They do not prove that physical motion looked correct. Final motion remains a human-observed acceptance boundary.

## Model and private AMD deployment

The Pi SDK is the only layer that resolves a model provider. Domain and application code are model-independent. Each stage creates an isolated in-memory session and reports the selected provider and model at runtime.

The Track 2 target is a participant-controlled, dedicated vLLM service on Radeon Cloud. The model process is intended to run on that AMD Radeon GPU instance with ROCm; a shared public model API must not be the only core inference path.

```text
RDK Agent -> OpenAI-compatible private endpoint -> vLLM -> ROCm -> AMD Radeon GPU
     |
     `-> sophonctl -> RDK X5 -> probe-daemon -> servo capability
```

The current private client configuration selects:

| Field | Value |
| --- | --- |
| Pi provider | `amd` |
| Model | `Qwen3-Next-80B-A3B-Instruct` |
| API shape | OpenAI-compatible Chat Completions |
| Declared context window | 131,072 tokens |
| Declared maximum output | 8,192 tokens |

The real endpoint and API key are intentionally excluded. The public [sanitized Pi model configuration](submission/en/config/pi-models.amd-rocm.example.json) reads the key from an environment variable. This client configuration proves model routing only; it does not prove GPU type, ROCm version, serving backend, model revision, precision, or quantization.

## AMD Radeon and ROCm optimization

### Implemented inference-work reduction

The application already reduces unnecessary model work:

- Exact greeting and acknowledgement traffic bypasses inference.
- Intent classification uses a short, tool-free, Skill-free, context-free session.
- Each agent has one focused role rather than one expanding conversation.
- Only allowlisted Skills are loaded, and explicit selection evidence is required.
- Cross-stage text handoffs are bounded to the last 6,000 characters while files remain the durable source of truth.
- Deterministic scripts handle scaffolding, validation, packaging, hashes, and deployment without extra model calls.
- Independent in-memory sessions prevent unrelated history from accumulating across stages.

These controls reduce tokens, context growth, and variability regardless of accelerator. They are not substitutes for measured GPU optimization.

### Controlled optimization matrix

Hold prompts, output limits, software revision, and correctness criteria constant. Change one variable at a time.

| Experiment | Baseline | Candidate | Required evidence |
| --- | --- | --- | --- |
| Precision/quantization | Server default | Hardware-supported lower precision or quantized model | Exact launch flags, VRAM, correctness, TTFT, tokens/s |
| Context limit | Maximum supported | Bounded to measured workflow needs | Input tokens, truncation checks, latency, VRAM |
| Warm model | Cold process | Warm process with documented warm-up | Cold/warm samples, p50/p95 |
| Memory utilization | Server default | Tuned vLLM utilization | OOM-free repeated runs, peak VRAM |
| Concurrency | One request | Measured low concurrency | Per-request latency and throughput |
| Prompt workload | Full generic context | Scoped agent plus selected Skill | Token counts, stage correctness, end-to-end time |

Required metrics:

- Client time to first token (TTFT), p50 and p95.
- Decode output tokens per second.
- Total request latency.
- End-to-end workflow time.
- Peak VRAM and GPU utilization.
- Power or energy only where the target exposes reliable counters.
- Correct-response and acceptance rate under the same prompts.

The included [OpenAI-compatible benchmark script](submission/en/scripts/benchmark-openai-compatible.mjs) issues repeatable fixed-prompt streaming requests and reports p50/p95 client TTFT, total latency, decode throughput when token usage is returned, and response correctness. It never writes the API key to its report.

```sh
node submission/en/scripts/benchmark-openai-compatible.mjs \
  --provider amd \
  --runs 10 \
  --output submission/en/evidence/amd-endpoint-benchmark.json
```

The report contains the endpoint host for traceability but no scheme, path, or key. Remove or hash the host as well if it reveals private infrastructure. Run the same prompt set against baseline and tuned configurations, report p50 and p95 rather than only the fastest request, and interpret client results alongside server utilization and profiler evidence.

### AMD evidence boundary

| Item | Status |
| --- | --- |
| Client provider/model selection | Verified locally; sanitized in this repository |
| AMD Radeon GPU model | Evidence pending |
| ROCm/HIP version | Evidence pending |
| Dedicated vLLM server version and configuration | Evidence pending |
| Model repository/revision and precision/quantization | Evidence pending |
| Local `/v1/models` response | Evidence pending |
| Baseline and tuned TTFT | Evidence pending |
| Baseline and tuned decode throughput | Evidence pending |
| Peak VRAM/utilization | Evidence pending |
| End-to-end agent workflow latency | Evidence pending |

No unmeasured value should be changed from `Evidence pending` to a number. Before judging, attach redacted server output, the exact vLLM launch command, model revision, precision or quantization setting, container digest if used, warm-up policy, and a screenshot of the participant-controlled Radeon Cloud instance without credentials.

## Reproduce, run, and deploy

The following path separates development-host verification, read-only RDK X5 checks, full deployment, private AMD inference, and physical-action acceptance. Evaluators can run the local checks and read-only board checks without moving the robot.

### Repository layout

```text
rdk-sophon/
├── rdk-agent/       TypeScript multi-agent TUI and delivery tooling
├── rdk-sophon/      Rust device platform and sophonctl
└── submission/      Competition attachments, evidence, configuration, and scripts
```

### Prerequisites

Development host:

- macOS or Linux.
- Node.js 22.19 or newer and npm.
- Rust toolchain with Cargo.
- Podman and a pre-pulled `docker.io/library/python:3.12-slim` image for Robot Development Mode.
- SSH access to the RDK X5 for deployment.

RDK X5:

- Ubuntu on aarch64; the deployment flow has been exercised against Ubuntu 22.04.
- `systemd` and root access for installation.
- SSH host alias `x5-root`, or a replacement supplied to the deployment script.
- Python 3 and the device permissions required by the MagicBox runtime and `Hobot.GPIO`.

Private AMD inference:

- An AMD Radeon GPU environment with a compatible ROCm stack.
- A participant-controlled, dedicated OpenAI-compatible vLLM service.
- The sanitized Pi model configuration linked above.

### Install dependencies

From the repository root:

```sh
cd rdk-agent
npm ci

cd ../rdk-sophon
cargo build --workspace
```

The Rust workspace uses `Cargo.lock`; Cargo resolves the pinned dependency graph during the first build.

### Safe local verification

TypeScript:

```sh
cd rdk-agent
npm run check
npm test
```

Expected evidence for the submitted snapshot: the TypeScript check succeeds and 134 tests pass.

Rust, starting again from the repository root:

```sh
cd rdk-sophon
cargo test --workspace
cargo clippy --workspace -- -D warnings
cargo build --release --workspace
```

Expected evidence for the submitted snapshot: 62 tests pass, Clippy succeeds with warnings denied, and the release workspace builds. Some end-to-end tests bind local TCP or Unix sockets and must run in an environment that permits loopback socket binding.

The repository's `scripts/full_test.sh` pipeline was not recorded as a single run for this snapshot. Its constituent check, Clippy, test, and release-build stages were run separately and passed. A separate `cargo fmt --all -- --check` reported existing formatting differences; formatting is not part of `full_test.sh`.

### Inspect the TUI without moving hardware

From the repository root:

```sh
cd rdk-agent
npm start -- --workspace "$PWD/config/templates/magicbox-servo"
```

Use only inspection commands:

```text
/modes
/mode robot-development
/skills
/workspace
```

Do not submit an imperative robot request during a safe UI inspection. The default mode is Robot Application Mode, where an imperative request authorizes one mapped action.

### Configure the RDK X5 client

Create `~/.rdk-sophon/config.toml` on the development host:

```toml
[default]
host = "192.0.2.10:7777" # Documentation-only address; replace with the board address.
timeout = 30

[boards.x5]
host = "192.0.2.10:7777" # Documentation-only address; replace with the board address.
timeout = 30
```

Then run only read-only checks:

```sh
sophonctl --board x5 ping
sophonctl --board x5 state
sophonctl --board x5 plugins list
```

The submitted evidence captured `pong: true`, a live state snapshot, and the `servo` plugin on 2026-08-05.

### Deploy the complete stack

From the repository root:

```sh
export RDK_BOARD_IP=192.0.2.10 # Documentation-only address; replace with the board address.
./rdk-agent/deploy/install-rdk-agent-stack.sh \
  --ssh-host x5-root \
  --board-address "$RDK_BOARD_IP:7777"
```

This deploys board binaries and configuration, the servo plugin/runtime, development-host `sophonctl`, and the RDK Agent application/configuration. It performs read-only integration checks after installation.

Deployment-only variants:

```sh
# Board services and servo runtime only
./rdk-agent/deploy/install-rdk-agent-stack.sh \
  --board-only \
  --ssh-host x5-root \
  --board-address "$RDK_BOARD_IP:7777"

# Development host only
./rdk-agent/deploy/install-rdk-agent-stack.sh \
  --development-only \
  --board-address "$RDK_BOARD_IP:7777"
```

### Configure private AMD Radeon inference

The dedicated service must listen on `0.0.0.0:8000` when using the competition's Model API routing. Example service shape:

```sh
export MODEL_PATH_OR_ID=/path/to/model-or-hub-id
vllm serve "$MODEL_PATH_OR_ID" \
  --served-model-name Qwen3-Next-80B-A3B-Instruct \
  --host 0.0.0.0 \
  --port 8000
```

Copy the sanitized client configuration from the repository root:

```sh
mkdir -p ~/.pi/agent
cp submission/en/config/pi-models.amd-rocm.example.json ~/.pi/agent/models.json
```

Set the real private base URL only in the copied file. Keep the API key outside the repository:

```sh
read -r -s RDK_AMD_MODEL_API_KEY
export RDK_AMD_MODEL_API_KEY
```

Select the model in `~/.pi/agent/settings.json`:

```json
{
  "defaultProvider": "amd",
  "defaultModel": "Qwen3-Next-80B-A3B-Instruct"
}
```

Do not publish the live endpoint or key. Redact secrets and user-specific tunnel names from screenshots and logs.

### Capture server-side AMD evidence

Run equivalent commands inside the participant-controlled Radeon instance and save redacted output:

```sh
rocminfo
rocm-smi --showproductname --showdriverversion --showmeminfo vram
python3 -c 'import torch; print(torch.__version__); print(torch.version.hip); print(torch.cuda.get_device_name(0))'
python3 -c 'import vllm; print(vllm.__version__)'
curl http://127.0.0.1:8000/v1/models
```

Also record the exact vLLM launch command, model repository and revision, served model name, precision or quantization setting, container digest if used, and warm-up policy.

### Run Robot Development Mode

Start the TUI:

```sh
cd rdk-agent
npm start
```

Then run:

```text
/mode robot-development
/develop Create a new action that waves the left side once.
```

Observe the five delivery nodes. The final two acceptance stages may move real hardware. Keep the robot clear of people and obstacles and be prepared to abort.

### Run Robot Application Mode

After the Skill is installed:

```text
/mode robot-application
Wave the left side once.
```

An imperative request authorizes one mapped action. A successful command path does not by itself prove that physical motion was correct; record a human observation separately.

### Expected outputs

- Test reports for the TypeScript and Rust workspaces.
- TUI stage progress and tool/Skill events.
- An action-package release with deterministic metadata and hashes.
- A board deployment receipt and installed Skill.
- `sophonctl` state and plugin output.
- One CLI and one natural-language acceptance invocation.
- Redacted Radeon/ROCm/vLLM environment evidence and benchmark JSON.

### Troubleshooting boundaries

- If Rust end-to-end tests fail with `Operation not permitted` while binding `127.0.0.1`, run them outside a restricted sandbox.
- If HTTP or WebSocket adapters are used, explicitly pass `/run/probe-daemon/probe.sock` until their source defaults are aligned with daemon configuration.
- If a real servo action fails, verify GPIO permissions for the unprivileged `probe` service user.
- If the model is unavailable, verify provider/model selection, the private endpoint, and the API-key environment variable without printing the key.

## Verification evidence and boundary

Evidence was captured on 2026-08-05. The [raw verification record](submission/en/evidence/verification-2026-08-05.md) contains the sanitized command transcript.

| Area | Result |
| --- | --- |
| TypeScript static check | Passed |
| `rdk-agent` automated tests | 134 passed, 0 failed |
| `rdk-sophon` automated tests | 62 passed, 0 failed |
| Rust Clippy with warnings denied | Passed |
| Rust release workspace build | Passed |
| Live RDK X5 ping | `pong: true` |
| Dynamic plugin discovery | `servo` plugin found |

Sanitized live RDK X5 capture:

```text
board timestamp: 2026-08-05T11:02:17Z
CPU: 8 usage entries; reported core frequency 1500 MHz
memory: 7,424,344,064 bytes total; 3,550,343,168 bytes used
thermal-ddr: 55.113 C
thermal-cpu: 54.38 C
plugin: servo - MagicBox servo posture control
```

MAC addresses and private infrastructure details are intentionally omitted.

![Repository verification snapshot](submission/en/assets/test-evidence.png)

![Sanitized live RDK X5 evidence](submission/en/assets/board-evidence.png)

The Rust formatting check is not presented as passing: `cargo fmt --all -- --check` reported existing formatting differences. The evidence also does not describe the complete `scripts/full_test.sh` pipeline as green.

The private Pi client was verified to select provider `amd` and model `Qwen3-Next-80B-A3B-Instruct` through OpenAI-compatible Chat Completions. For **that vLLM agent backend**, this repository snapshot does **not** independently attest the server-side Radeon GPU model, ROCm/HIP version, vLLM version or launch command, model revision, precision/quantization, client TTFT and decode throughput, server utilization, VRAM, or profiler results. The submission does not invent those figures.

For the **team's own trained model** (`Qwen3-32B-Agentic-SFT-r1-v3`) those figures are attested and reproducible: GPU `gfx1100`, ROCm 7.2.1, torch 2.9.1+rocm7.2.0, adapter SHA-256 `4dcee691…f20bf`, NF4 4-bit quantization, and a baseline-versus-optimized A/B measured on that host (user-visible TTFT p50 17.41 s → 8.26 s, peak VRAM 27.99 → 28.06 GB, 88/88 outputs byte-identical). See the [model track index](submission/en/MODEL_TRACK.md); `results.json` is generated by the benchmark on the Radeon host rather than transcribed by hand.

## Demo video

**Public video URL:** `<DEMO VIDEO URL>`

**Recommended PR label:** `Demo video - 3-5 minutes`

The video has already been recorded. Replace the URL above and the Track 2 metadata placeholder before opening the competition pull request, then verify access from a signed-out browser.

Suggested 3-5 minute chapter list:

| Time | Content | Required evidence |
| --- | --- | --- |
| 0:00-0:25 | Problem and product | Natural language -> tested robot capability. |
| 0:25-0:50 | Architecture | Private model, RDK Agent, `sophonctl`, RDK X5. |
| 0:50-1:15 | Read-only board proof | `ping`, `state`, and `plugins list`. |
| 1:15-2:45 | Robot Development Mode | Intent gate; Test -> Code -> Verify; release and Skill installation. |
| 2:45-3:30 | Acceptance | CLI invocation, then natural-language Skill invocation; show the physical result. |
| 3:30-4:15 | AMD execution | Participant-controlled Radeon Cloud instance, redacted ROCm/vLLM/model evidence, streaming response, and redacted runtime evidence. |
| 4:15-4:40 | Safety and value | Allowlists, offline tests, evidence gate, and direction guard. |
| 4:40-5:00 | Closing | Source, reproducibility, and project value. |

Privacy review:

- Blur or crop API keys, SSH keys, private URLs, email addresses, MAC addresses, and unnecessary internal IP addresses.
- Do not show `~/.pi/agent/auth.json` or a private `apiKey` value.
- Show only the sanitized configuration under `submission/en/config/`.
- Distinguish the generated cover illustration from real hardware footage.
- Distinguish command-path success from a human observation of physical motion.

## Current limitations and roadmap

- Persistent local multi-turn memory and local RAG are not implemented.
- Normal-path human approval before every real action is not implemented; an imperative application request authorizes one action.
- TCP transport currently lacks client authentication, mTLS, and rate limiting.
- Workflow and human-input state are not persisted across process restarts.
- Model runtime configuration is global rather than selected per agent profile.
- Server-side Radeon/ROCm/vLLM proof and measured optimization results are still required.
- Physical motion quality requires human observation.

These are roadmap items, not completed features.

## Track 2 rubric map

The governing rules score 100 base points plus 20 optional points. The submission maps its evidence as follows:

| Rubric item | Submission evidence |
| --- | --- |
| Scenario and positioning | Executive summary, target users, Sophon naming metaphor, and RDK X5 device operation. |
| Agent core capability | Tool calling, ordered multi-step workflow, agent/tool permissions, TDD delivery, deterministic guards, and evidence gates. |
| Smooth multi-turn interaction | Intent routing, bounded revision, human follow-up, and two operating modes; persistent memory is not claimed. |
| Core inference on Radeon | Dedicated private vLLM architecture and configured client model; server hardware and ROCm proof remain required. |
| Radeon inference optimization | Implemented inference-work reduction plus a reproducible runtime benchmark plan; measured results remain required. |
| Optional Radeon Cloud Model API optimization | A dedicated Model API path is designed; any quantization or precision claim must be backed by the final server configuration and comparison. |

## Deliverables and validation

Primary attachments were validated on 2026-08-06:

| Deliverable | File | SHA-256 |
| --- | --- | --- |
| Project specification | [RDK_Agent_Project_Specification.pdf](submission/en/deliverables/RDK_Agent_Project_Specification.pdf) | `6f0b324449f1216c0e6256f615ed9b42f7b2f276cc4fb0cb94fd8c0259850efc` |
| Pitch deck | [RDK_Agent_Track2_Pitch_Deck.pptx](submission/en/deliverables/RDK_Agent_Track2_Pitch_Deck.pptx) | `807e1711d3e14d536b5704f8510120a1c1a614cebb9902e945d4026b570461ce` |

The delivery also includes:

- Complete TypeScript and Rust source trees with lockfiles.
- This English competition README and a Chinese localized reference.
- Architecture, workflow, board-evidence, test-evidence, and Sophon concept images.
- A sanitized AMD model-provider example and benchmark script.
- A demo video placeholder and shot list for the already recorded video.
- Raw verification evidence and final submission review items.

Validation recorded for the current attachments:

- The PDF is a readable, unencrypted 12-page A4 document with no forms or JavaScript.
- The PPTX archive is structurally valid, contains 12 slides and speaker-note source blocks, and passed rendered overflow inspection.
- The editable SVG diagrams are valid XML.
- The benchmark utility and example JSON configuration pass syntax validation.
- The public-facing submission sources contained no detected common credential pattern, private tunnel URL, or board-private IP address at validation time.

Evidence integrity matters: this submission does not expose credentials, does not present development-host Mach-O binaries as RDK X5 deliverables, does not treat a successful command as proof of physical motion quality, and does not report estimated AMD performance as measured data.

## Final submission checklist

Identity, eligibility, and PR:

- [ ] Replace every `<TEAM OR PARTICIPANT NAME>` placeholder with the exact Luma team name, or the participant's legal name if no team name was registered.
- [ ] Replace every `<DEMO VIDEO URL>` placeholder and verify the link while signed out.
- [ ] Confirm every team member is approved on Luma and enrolled in the AMD AI Developer Program.
- [ ] Confirm the team has one to three members and everyone used the same team name.
- [ ] Fork the official competition repository and create one project directory, for example `submissions/track2-your-team-rdk-agent/`.
- [ ] Use the title `Track 2, <TEAM OR PARTICIPANT NAME>, RDK Agent` and keep competition-facing copy in English.
- [ ] Confirm the source and all submitted links are publicly readable.

Source and verification:

- [x] Complete `rdk-agent` and `rdk-sophon` sources and dependency lockfiles are present.
- [x] TypeScript check and 134 tests passed.
- [x] Rust workspace tests (62), Clippy with warnings denied, and release build passed.
- [ ] Fix existing Rust formatting differences and rerun `cargo fmt --all -- --check` if time permits.
- [ ] Align the HTTP/WebSocket default daemon socket with `/run/probe-daemon/probe.sock`, or explicitly pass that path in each demo command.
- [ ] Verify that the unprivileged `probe` service user has the GPIO permissions required by `Hobot.GPIO`.
- [ ] Decide whether to add a repository-level LICENSE after owner review; Cargo metadata currently declares MIT but no root license file exists.
- [ ] Exclude ignored local `target/` and `node_modules/` directories from the competition copy.

Required AMD evidence:

- [ ] Attach a redacted Radeon Cloud instance screenshot.
- [ ] Capture Radeon GPU product, ROCm/HIP version, vLLM version, and the exact launch command.
- [ ] Record model repository/revision, served name, and precision/quantization.
- [ ] Capture a local `/v1/models` response.
- [ ] Run the included benchmark against baseline and tuned configurations.
- [ ] Report p50/p95 TTFT, decode throughput, end-to-end time, peak VRAM, utilization, and correctness.
- [ ] Keep raw and redacted evidence with the submitted project; never publish the endpoint credential or API key.

Demo and integrity:

- [ ] Confirm the video is approximately 3-5 minutes and shows real CLI/TUI operation, both operating modes, read-only board evidence, actual Radeon/ROCm inference, and the final physical action.
- [ ] Confirm the video contains no credentials or private infrastructure details.
- [ ] Optionally replace a conceptual cover or placeholder with a strong real frame from the recorded demo.
- [ ] Repeat link, secret, private-URL, token, key, and personal-data checks after the final source freeze and after copying into the official repository.
- [ ] Open the PDF and PPTX on a second machine.
- [ ] Ensure no `Evidence pending` item has been replaced with an unmeasured estimate.
- [ ] Review the complete worktree and explicitly approve commit and publication.
