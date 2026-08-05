import { RouteUserRequest } from "../../application/route-user-request.ts";
import { RunOrchestration } from "../../application/run-orchestration.ts";
import { PiAgentRunner } from "../../infra/pi-agent-runner.ts";
import { PiRequestIntentClassifier } from "../../infra/pi-request-intent-classifier.ts";
import type { ResolvedWorkspace } from "../../infra/managed-workspace.ts";
import { inspectDevelopmentWorkspace } from "../../infra/workspace-preflight.ts";
import type { AgentConfiguration } from "../../shared/agent-configuration.ts";
import type { AgentRunner } from "../../shared/agent-runner.ts";
import type { RequestIntentClassifier } from "../../shared/request-intent-classifier.ts";
import type { WorkflowEvent } from "../../shared/workflow-events.ts";

export interface HeadlessRunnerDependencies {
	agentRunner?: AgentRunner;
	intentClassifier?: RequestIntentClassifier;
	write?: (text: string) => void;
}

function printEvent(event: WorkflowEvent, write: (text: string) => void, showWorkflowProgress: boolean): void {
	if (event.type === "workflow-started") {
		write(`RDK Agent · ${event.modeName}\n用户指令：${event.request}\n`);
	} else if (event.type === "loop-iteration") {
		write(`\n[${event.loopName}] 第 ${event.iteration}/${event.maxIterations} 次迭代\n`);
	} else if (event.type === "stage-status") {
		if (showWorkflowProgress) write(`\n[${event.stageId}] ${event.status}${event.detail ? `：${event.detail}` : ""}\n`);
	} else if (event.type === "agent-event") {
		write(event.text);
	} else if (event.type === "skills-loaded") {
		write(`\n[Skill 已加载] ${event.skills.map((skill) => skill.name).join(", ") || "无"}\n`);
	} else if (event.type === "skill-selected") {
		write(`\n[Skill 已选择] ${event.skill.name}\n`);
	} else if (event.type === "workflow-finished") {
		write(`\n${event.succeeded ? "验收通过" : "流程中止"}：${event.detail}\n`);
	}
}

export async function runHeadless(
	workspace: ResolvedWorkspace,
	configuration: AgentConfiguration,
	modeId: string,
	request: string,
	dependencies: HeadlessRunnerDependencies = {},
): Promise<boolean> {
	const mode = configuration.modes.find((candidate) => candidate.id === modeId);
	if (!mode) throw new Error(`模式配置不存在：${modeId}`);
	const write = dependencies.write ?? ((text: string) => process.stdout.write(text));
	let workflowRequest = request;
	if (mode.type === "robot-development") {
		const forceDevelopment = request.startsWith("/develop ");
		const candidateRequest = forceDevelopment ? request.slice("/develop ".length).trim() : request;
		if (!candidateRequest) throw new Error("/develop 需要明确的用户指令");
		const classifier = dependencies.intentClassifier
			?? new PiRequestIntentClassifier(workspace.root, configuration.intake.timeoutSeconds);
		const decision = await new RouteUserRequest(classifier, configuration.intake).execute({
			request: candidateRequest,
			mode,
			forceDevelopment,
			onEvent(event) {
				if (event.type === "intent-classification-started") write("[输入识别] 意图分类 Agent 正在判断……\n");
				if (event.type === "intent-classification-failed") write(`[输入识别失败] ${event.detail}\n`);
			},
		});
		if (decision.kind === "conversation") {
			write(`[输入识别] 非研发对话；研发流程未启动。${decision.userMessage ? `\n${decision.userMessage}` : ""}\n`);
			return true;
		}
		if (decision.kind === "clarification") {
			write(`[需要确认研发意图] ${decision.question}\n研发流程未启动。\n`);
			return false;
		}
		if (decision.kind === "unsupported-development") {
			write(`[输入识别] 当前研发流程不支持：${decision.reason}\n研发流程未启动。\n`);
			return false;
		}
		// Classification grants or denies authority; it must never rewrite the user's authorized request.
		workflowRequest = candidateRequest;
		write(`[输入识别] 已确认该用户指令需要启动研发流程 · 置信度 ${Math.round(decision.confidence * 100)}%\n`);
		const problem = inspectDevelopmentWorkspace(workspace.root, configuration.workspace.requiredPaths);
		if (problem) throw new Error(`开发工作区校验失败：缺少 ${problem.missingPaths.join(", ")}`);
	}
	const result = await new RunOrchestration(dependencies.agentRunner ?? new PiAgentRunner(), configuration.profiles).execute({
		mode,
		request: workflowRequest,
		workspaceRoot: workspace.root,
		skillDirectory: configuration.skillDirectory,
		humanInLoop: {
			async requestInput(humanRequest) {
				throw new Error(`无交互运行禁止 Human-in-the-loop：${humanRequest.agentName}：${humanRequest.question}`);
			},
		},
		onEvent: (event) => printEvent(event, write, mode.type === "robot-development"),
	});
	return result.succeeded;
}
