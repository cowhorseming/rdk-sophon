import { RunOrchestration } from "../../application/run-orchestration.ts";
import { PiAgentRunner } from "../../infra/pi-agent-runner.ts";
import type { ResolvedWorkspace } from "../../infra/managed-workspace.ts";
import { inspectDevelopmentWorkspace } from "../../infra/workspace-preflight.ts";
import type { AgentConfiguration } from "../../shared/agent-configuration.ts";
import type { WorkflowEvent } from "../../shared/workflow-events.ts";

function printEvent(event: WorkflowEvent): void {
	if (event.type === "workflow-started") {
		process.stdout.write(`RDK Agent · ${event.modeName}\n需求：${event.request}\n`);
	} else if (event.type === "loop-iteration") {
		process.stdout.write(`\n[${event.loopName}] 第 ${event.iteration}/${event.maxIterations} 次迭代\n`);
	} else if (event.type === "stage-status") {
		process.stdout.write(`\n[${event.stageId}] ${event.status}${event.detail ? `：${event.detail}` : ""}\n`);
	} else if (event.type === "agent-event") {
		process.stdout.write(event.text);
	} else if (event.type === "skills-loaded") {
		process.stdout.write(`\n[Skill 已加载] ${event.skills.map((skill) => skill.name).join(", ") || "无"}\n`);
	} else if (event.type === "skill-selected") {
		process.stdout.write(`\n[Skill 已选择] ${event.skill.name}\n`);
	} else if (event.type === "workflow-finished") {
		process.stdout.write(`\n${event.succeeded ? "验收通过" : "流程中止"}：${event.detail}\n`);
	}
}

export async function runHeadless(
	workspace: ResolvedWorkspace,
	configuration: AgentConfiguration,
	modeId: string,
	request: string,
): Promise<boolean> {
	const mode = configuration.modes.find((candidate) => candidate.id === modeId);
	if (!mode) throw new Error(`模式配置不存在：${modeId}`);
	if (mode.type === "robot-development") {
		const problem = inspectDevelopmentWorkspace(workspace.root, configuration.workspace.requiredPaths);
		if (problem) throw new Error(`开发工作区校验失败：缺少 ${problem.missingPaths.join(", ")}`);
	}
	const result = await new RunOrchestration(new PiAgentRunner(), configuration.profiles).execute({
		mode,
		request,
		workspaceRoot: workspace.root,
		skillDirectory: configuration.skillDirectory,
		humanInLoop: {
			async requestInput(humanRequest) {
				throw new Error(`无交互运行禁止 Human-in-the-loop：${humanRequest.agentName}：${humanRequest.question}`);
			},
		},
		onEvent: printEvent,
	});
	return result.succeeded;
}
