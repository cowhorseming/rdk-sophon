# RDK Agent - AMD AI DevMaster Track 2 Submission

RDK Agent turns a natural-language robot requirement into a tested, validated, deployable, and reusable capability for an RDK X5 device. The system combines a private multi-agent development runtime on the development host with a Rust device-access platform on the board.

![RDK Agent concept cover](assets/rdk-agent-hero.png)

## Why “Sophon”?

The device subsystem `rdk-sophon` borrows its name from the sophon (智子) concept in *The Three-Body Problem*. The novel imagines a sophisticated messenger sent to Earth to observe and communicate. RDK Sophon turns that idea into an owner-controlled device pattern: deploy a small probe to the development board, continuously observe its state, and use it as the governed communication bridge between `rdk-agent` and the hardware.

![Original Sophon naming concept](assets/sophon-three-body-concept.png)

The visual above is a project-created AI-generated conceptual illustration. No official artwork or assets from the novel or adaptations are used. The name is a literary allusion used only to explain an internal code name; this independent project is not endorsed by or affiliated with the work's author, publishers, rights holders, or screen adaptations.

## Submission index

| Requirement | Artifact | Status |
| --- | --- | --- |
| Project specification | [Markdown source](PROJECT_SPECIFICATION.md) and [PDF](deliverables/RDK_Agent_Project_Specification.pdf) | Complete |
| Complete source and README | [Repository root](../../README.md) and [reproducibility guide](REPRODUCIBILITY.md) | Complete |
| Demo video, 3-5 minutes | [Video placeholder and shot list](VIDEO.md) | **Add public URL** |
| Supplementary PPT or poster | [PowerPoint deck](deliverables/RDK_Agent_Track2_Pitch_Deck.pptx) | Complete |
| AMD Radeon/ROCm plan | [Private deployment and optimization guide](AMD_RADEON_ROCM.md) | Complete; server proof noted below |
| Verification evidence | [Evidence log](evidence/verification-2026-08-05.md) | Captured; refresh after the final source freeze |
| PR copy | [PR description](PR_DESCRIPTION.md) | Complete; add identity and video URL |
| Final review | [Submission checklist](SUBMISSION_CHECKLIST.md) | Team/video fields and the open technical evidence items remain |
| Delivery integrity | [Validated manifest and SHA-256 checksums](MANIFEST.md) | Complete |

## Project summary

RDK Agent has two operating modes:

- **Robot Development Mode** routes a supported request through an intent gate and a multi-agent TDD loop, then builds a release, deploys it to the RDK X5, installs the generated Skill, and runs controlled acceptance checks.
- **Robot Application Mode** selects an installed Skill for a read-only query or one explicitly requested robot action.

The five ordered development nodes are:

1. Action Package TDD: Test Agent -> Coding Agent -> Verification Agent.
2. Board Release Deployment.
3. Development-host Skill Installation.
4. CLI Hardware Acceptance.
5. Natural-Language Skill Acceptance.

## Verified evidence boundary

Verified on 2026-08-05:

- TypeScript type check passed.
- `rdk-agent`: 134/134 automated tests passed.
- `rdk-sophon`: 62/62 automated tests passed.
- Rust Clippy passed with warnings denied.
- Rust release workspace build passed.
- A configured RDK X5 responded to `ping` and `state`; the `servo` plugin was discovered.
- The private Pi runtime selects provider `amd` and model `Qwen3-Next-80B-A3B-Instruct` through an OpenAI-compatible endpoint.

Not independently attested by this repository snapshot:

- Server-side Radeon GPU model, ROCm version, vLLM launch command, and model precision/quantization.
- Client-side TTFT and output-token throughput. The provided benchmark script is ready, but no API key or private endpoint is included in this submission.

The submission therefore does not invent AMD performance figures. Replace the marked evidence fields only with redacted, reproducible logs from the participant-controlled Radeon Cloud instance.

## Pull request title

```text
Track 2, <TEAM OR PARTICIPANT NAME>, RDK Agent
```

All submitted descriptions and artifacts in this directory are written in English. Internal Chinese engineering documentation remains in the source tree and is not used as the competition-facing project description.
