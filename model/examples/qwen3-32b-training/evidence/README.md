# Evidence boundary

此处只保存足以审计训练完成状态的小型证据，不保存 adapter、optimizer、RNG 二进制、完整 checkpoint 或 102 MB 正式训练 telemetry。step 6/32 的约 1.9 MB 门禁 telemetry 被保留，用于独立重算 authorization 引用的哈希。

- `run-manifest.json` 是不可变启动清单，状态保持 `PREPARED` 属于设计行为。
- Phase 1 完成看 `phase1-controller/*` 与 `checkpoint-000010/COMPLETE`。
- 最终完成看 `phase2-controller/*` 与 `checkpoint-000119/COMPLETE`。
- Checkpoint manifest 记录了未复制二进制文件的原始大小与 SHA，但不能替代那些二进制文件本身。
- `formal-restart-authorization.json` 和 launch binding 均绑定历史 run，仅供审计，不可用于授权新 run。

证据能证明 exact 源码完成了正式训练；不能证明当前省略的模型/adapter 文件存在，也不能替代 held-out Agentic A/B。
