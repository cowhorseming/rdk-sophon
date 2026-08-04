import { join, resolve } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import type { AgentExpectation, AgentRunRequest, AgentRunResult, AgentRunner, AgentSkillInfo } from "../shared/agent-runner.ts";
import { AgentPromptBuilder } from "./agent-prompt-builder.ts";
import { scopedAgentTools } from "./scoped-agent-tools.ts";
import { enforceDeliveryContract } from "./delivery-contract-validator.ts";
import {
	enforceTestExecutionEvidence,
	enforceVerificationEvidence,
	needsTestExecutionEvidenceRetry,
	needsVerificationEvidenceRetry,
	testExecutionEvidenceRetryPrompt,
	verificationEvidenceRetryPrompt,
} from "./verification-evidence.ts";

export function createAgentResourceLoader(request: AgentRunRequest): DefaultResourceLoader {
	const skillPaths = request.profile.skills.map((name) => join(request.skillDirectory, name));
	const allowedSkillFiles = new Set(skillPaths.map((path) => resolve(path, "SKILL.md")));
	return new DefaultResourceLoader({
		cwd: request.workspaceRoot,
		agentDir: getAgentDir(),
		noSkills: true,
		additionalSkillPaths: skillPaths,
		skillsOverride: ({ skills, diagnostics }) => ({
			skills: skills.filter((skill) => allowedSkillFiles.has(resolve(skill.filePath))),
			diagnostics,
		}),
		appendSystemPromptOverride: (base) => [...base, request.profile.systemPrompt],
	});
}

export function selectedSkillFromRead(
	toolName: string,
	args: unknown,
	workspaceRoot: string,
	loadedSkills: readonly Skill[],
): Skill | undefined {
	if (toolName !== "read" || typeof args !== "object" || args === null || !("path" in args)) return undefined;
	const path = (args as { path?: unknown }).path;
	if (typeof path !== "string") return undefined;
	const absolutePath = resolve(workspaceRoot, path);
	return loadedSkills.find((skill) => resolve(skill.filePath) === absolutePath);
}

function skillInfo(skill: Skill): AgentSkillInfo {
	return { name: skill.name, description: skill.description, filePath: skill.filePath };
}

function toolCallSummary(toolName: string, args: unknown): string | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const values = args as Record<string, unknown>;
	if (toolName === "bash" && typeof values.command === "string") return values.command;
	if (["read", "edit", "write"].includes(toolName) && typeof values.path === "string") return values.path;
	return undefined;
}

function toolResultText(result: unknown): string {
	if (typeof result === "object" && result !== null && "content" in result && Array.isArray(result.content)) {
		return result.content
			.filter((item): item is { type: "text"; text: string } => typeof item === "object" && item !== null && item.type === "text" && typeof item.text === "string")
			.map((item) => item.text)
			.join("\n");
	}
	return String(result);
}

export function enforceApplicationSkillSelection(
	result: AgentRunResult,
	expectation: AgentExpectation,
	configuredSkillCount: number,
	selectedSkillCount: number,
): AgentRunResult {
	if (expectation !== "application" || result.outcome !== "completed" || configuredSkillCount === 0 || selectedSkillCount > 0) {
		return result;
	}
	return {
		summary: result.summary,
		outcome: "needs-human",
		question: "机器人应用 Agent 未读取任何白名单 Skill，无法证明本次需求经过 Skill 选择与约束。请补充需求后重试，或输入 /abort 终止。",
	};
}

export function needsConfiguredSkillSelectionRetry(
	result: AgentRunResult,
	configuredSkillCount: number,
	selectedSkillCount: number,
): boolean {
	return result.outcome === "completed" && configuredSkillCount > 0 && selectedSkillCount === 0;
}

export function configuredSkillSelectionRetryPrompt(skills: readonly Pick<Skill, "name" | "filePath">[]): string {
	const files = skills.map((skill) => `- ${skill.name}: ${skill.filePath}`).join("\n");
	return `运行时检测到你尚未通过 read 读取任何已配置 Skill，因此不能接受刚才的完成结论。
请立即从下列精确路径中选择与需求匹配的 Skill，用 read 完整读取对应 SKILL.md；不得在业务工作区猜路径：
${files}
读取后核对本阶段工作是否符合 Skill，再简洁复述交付结论，并重新输出本阶段要求的单行 RDK_AGENT_RESULT。不要重复已经完成的文件编辑或真实硬件动作。`;
}

export function exceedsToolCallLimit(toolCalls: number, maxToolCalls?: number): boolean {
	return maxToolCalls !== undefined && toolCalls > maxToolCalls;
}

/** Pi SDK adapter. It is the only layer that knows how an agent session is created. */
export class PiAgentRunner implements AgentRunner {
	private readonly promptBuilder = new AgentPromptBuilder();

	async run(request: AgentRunRequest): Promise<AgentRunResult> {
		const resourceLoader = createAgentResourceLoader(request);
		await resourceLoader.reload();
		const loadedSkills = resourceLoader.getSkills().skills;
		const loadedNames = new Set(loadedSkills.map((skill) => skill.name));
		const missingSkills = request.profile.skills.filter((name) => !loadedNames.has(name));
		if (missingSkills.length > 0) {
			throw new Error(`配置的 Skill 加载失败：${missingSkills.join(", ")}`);
		}
		request.onEvent({ type: "skills-loaded", skills: loadedSkills.map(skillInfo) });

		const { session, modelFallbackMessage } = await createAgentSession({
			cwd: request.workspaceRoot,
			resourceLoader,
			sessionManager: SessionManager.inMemory(request.workspaceRoot),
			noTools: "builtin",
			tools: [...request.profile.tools],
			customTools: scopedAgentTools(request.workspaceRoot, request.skillDirectory, request.profile, {
				expectation: request.expectation,
				userRequest: request.userRequest,
			}),
		});
		const text: string[] = [];
		let toolCalls = 0;
		let sawBash = false;
		let bashHadError = false;
		const selectedSkills = new Set<string>();
		let limitError: string | undefined;
		const abortForLimit = (message: string): void => {
			if (limitError) return;
			limitError = message;
			request.onEvent({ type: "status", message });
			void session.abort();
		};
		const unsubscribe = session.subscribe((event) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				text.push(event.assistantMessageEvent.delta);
				request.onEvent({ type: "text", text: event.assistantMessageEvent.delta });
			}
			if (event.type === "tool_execution_start") {
				toolCalls++;
					request.onEvent({ type: "tool-start", toolName: event.toolName, summary: toolCallSummary(event.toolName, event.args) });
				const selectedSkill = selectedSkillFromRead(event.toolName, event.args, request.workspaceRoot, loadedSkills);
				if (selectedSkill && !selectedSkills.has(selectedSkill.name)) {
					selectedSkills.add(selectedSkill.name);
					request.onEvent({ type: "skill-selected", skill: skillInfo(selectedSkill) });
				}
				if (exceedsToolCallLimit(toolCalls, request.profile.maxToolCalls)) {
					abortForLimit(`${request.profile.name} 超过工具调用上限 ${request.profile.maxToolCalls}`);
				}
			}
			if (event.type === "tool_execution_end") {
				if (event.toolName === "bash") {
					sawBash = true;
						bashHadError = event.isError;
					}
					request.onEvent({ type: "tool-end", toolName: event.toolName, result: toolResultText(event.result), isError: event.isError });
			}
		});

		const timer = setTimeout(
			() => abortForLimit(`${request.profile.name} 超过阶段超时 ${request.profile.timeoutSeconds} 秒`),
			request.profile.timeoutSeconds * 1_000,
		);
		try {
			const model = session.model ? `${session.model.provider}/${session.model.id}` : "未配置";
			request.onEvent({
				type: "status",
				message: `已创建 Pi session；模型：${model}；推理级别：${session.thinkingLevel}；模型回退：${modelFallbackMessage ?? "无"}；工具：${request.profile.tools.join(", ")}；执行环境：${request.profile.sandbox?.kind === "podman" ? `Podman ${request.profile.sandbox.image}（离线、工作区只读）` : "宿主机"}；Skill 白名单：${loadedSkills.map((skill) => skill.name).join(", ") || "无"}`,
			});
			try {
				await session.prompt(this.promptBuilder.build(request));
			} catch (error) {
				if (limitError) throw new Error(limitError);
				throw error;
			}
			if (limitError) throw new Error(limitError);
			let summary = text.join("").trim();
			if (!summary) throw new Error("Agent 未返回文本交付物");
			let result = this.parseResult(summary, request.expectation);
			if (needsConfiguredSkillSelectionRetry(result, request.profile.skills.length, selectedSkills.size)) {
				request.onEvent({ type: "status", message: "完成结论缺少 Skill 读取证据；在同一 Session 内给出精确路径并强制读取" });
				const retryStart = text.length;
				await session.prompt(configuredSkillSelectionRetryPrompt(loadedSkills));
				if (limitError) throw new Error(limitError);
				summary = text.slice(retryStart).join("").trim();
				if (!summary) throw new Error("Agent 未返回 Skill 读取后的补充结论");
				result = this.parseResult(summary, request.expectation);
			}
			result = enforceApplicationSkillSelection(
				result,
				request.expectation,
				request.profile.skills.length,
				selectedSkills.size,
			);
			const hasBashTool = request.profile.tools.includes("bash");
			if (needsTestExecutionEvidenceRetry(result, request.expectation, hasBashTool, { sawBash, bashHadError })) {
				request.onEvent({ type: "status", message: "测试完成结论缺少执行证据；在同一 Session 内强制运行本阶段测试" });
				const retryStart = text.length;
				await session.prompt(testExecutionEvidenceRetryPrompt);
				if (limitError) throw new Error(limitError);
				summary = text.slice(retryStart).join("").trim();
				if (!summary) throw new Error("测试 Agent 未返回补充执行结论");
				result = this.parseResult(summary, request.expectation);
			}
			if (needsVerificationEvidenceRetry(result, request.expectation, { sawBash, bashHadError })) {
				request.onEvent({ type: "status", message: "验证结论缺少命令证据；在同一 Session 内强制补跑一次安全测试" });
				const retryStart = text.length;
				await session.prompt(verificationEvidenceRetryPrompt);
				if (limitError) throw new Error(limitError);
				summary = text.slice(retryStart).join("").trim();
				if (!summary) throw new Error("验证 Agent 未返回补充测试结论");
				result = this.parseResult(summary, request.expectation);
			}
			result = enforceTestExecutionEvidence(result, request.expectation, hasBashTool, { sawBash, bashHadError });
			result = enforceVerificationEvidence(result, request.expectation, { sawBash, bashHadError });
			const validated = await enforceDeliveryContract(
				result,
				request.workspaceRoot,
				request.skillDirectory,
				request.profile.validation,
			);
			if (validated.outcome === "revision" && result.outcome === "completed") {
				request.onEvent({ type: "status", message: `确定性交付校验要求返工：${validated.feedback}` });
			}
			return validated;
		} finally {
			clearTimeout(timer);
			unsubscribe();
			session.dispose();
		}
	}

	private parseResult(text: string, expectation: AgentExpectation): AgentRunResult {
		const marker = "RDK_AGENT_RESULT:";
		const markerIndex = text.lastIndexOf(marker);
		if (markerIndex < 0) {
			return expectation === "verification"
				? { summary: text, outcome: "needs-human", question: "验证 Agent 未返回结构化结论，请人工判断是否继续。" }
				: { summary: text, outcome: "completed" };
		}

		const summary = text.slice(0, markerIndex).trim();
		const encoded = text.slice(markerIndex + marker.length).trim();
		let value: unknown;
		try {
			value = JSON.parse(encoded);
		} catch {
			return { summary: summary || text, outcome: "needs-human", question: "Agent 的结构化结果无法解析，请人工提供继续方向。" };
		}
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return { summary: summary || text, outcome: "needs-human", question: "Agent 的结构化结果格式不正确，请人工提供继续方向。" };
		}

		const result = value as Record<string, unknown>;
		const status = result.status;
		const feedback = typeof result.feedback === "string" ? result.feedback : undefined;
		const question = typeof result.question === "string" ? result.question : undefined;
		if (status === "needs-human") return { summary: summary || text, outcome: "needs-human", question };
		if (expectation === "verification" && status === "passed") return { summary: summary || "验证通过", outcome: "completed" };
		if (expectation === "verification" && status === "revision") {
			return { summary: summary || feedback || "验证要求返工", outcome: "revision", feedback };
		}
		if (expectation !== "verification" && status === "completed") return { summary: summary || "交付完成", outcome: "completed" };
		return { summary: summary || text, outcome: "needs-human", question: "Agent 返回了不适用于当前阶段的状态，请人工判断。" };
	}
}
