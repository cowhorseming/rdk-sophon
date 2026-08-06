# Demo Video

**Public video URL:** `<DEMO VIDEO URL>`

**Recommended PR label:** `Demo video - 3-5 minutes`

The video has already been recorded by the participant. Replace the URL above and the same placeholder in `PR_DESCRIPTION.md` before opening the competition pull request. Verify access from a signed-out browser.

## Suggested 3-5 minute chapter list

| Time | Content | Required evidence |
| --- | --- | --- |
| 0:00-0:25 | Problem and product | Natural language -> tested robot capability. |
| 0:25-0:50 | Architecture | Private model, RDK Agent, `sophonctl`, RDK X5. |
| 0:50-1:15 | Read-only board proof | `ping`, `state`, and `plugins list`. |
| 1:15-2:45 | Robot Development Mode | Intent gate; Test -> Code -> Verify; release and Skill installation. |
| 2:45-3:30 | Acceptance | CLI invocation, then natural-language Skill invocation; show physical result. |
| 3:30-4:15 | AMD execution | Participant-controlled Radeon Cloud instance, redacted ROCm/vLLM/model evidence, streaming response, and redacted runtime evidence. |
| 4:15-4:40 | Safety and value | Allowlists, offline tests, evidence gate, direction guard. |
| 4:40-5:00 | Closing | Source, reproducibility, and project value. |

## Privacy review

- Blur or crop API keys, SSH keys, private URLs, email addresses, MAC addresses, and internal IPs that are not needed.
- Do not show the contents of `~/.pi/agent/auth.json` or the private `apiKey` field.
- When showing the model configuration, use the sanitized example in `submission/en/config/`.
- Distinguish a generated cover illustration from real hardware footage.
