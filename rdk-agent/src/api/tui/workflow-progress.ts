import type { AgentProfile, StageId } from "../../domain/agent-profile.ts";
import type { OrchestrationMode, RobotDevelopmentMode } from "../../domain/orchestration-mode.ts";
import type { StageStatus } from "../../domain/workflow.ts";
import { stageMarker, tuiStyle } from "./tui-style.ts";

export interface LoopIterationProgress {
	loopId: string;
	loopName: string;
	iteration: number;
	maxIterations: number;
}

/** Application mode has one execution step, so only development mode renders a progress panel. */
export function shouldDisplayWorkflowProgress(mode: OrchestrationMode, workflowVisible: boolean): boolean {
	return mode.type === "robot-development" && workflowVisible;
}

export function shouldDisplayAgentLifecycle(mode: OrchestrationMode): boolean {
	return mode.type === "robot-development";
}

interface ProgressNode {
	id: StageId;
	label: string;
	agentIds: readonly StageId[];
}

export function workflowStageLabel(
	mode: OrchestrationMode,
	profiles: readonly AgentProfile[],
	stageId: StageId,
): string {
	const loop = mode.type === "robot-development" ? mode.loops.find((candidate) => candidate.id === stageId) : undefined;
	if (loop) return loop.name;
	return profiles.find((profile) => profile.id === stageId)?.name ?? stageId;
}

export function workflowProgressReport(input: {
	mode: RobotDevelopmentMode;
	profiles: readonly AgentProfile[];
	statuses: ReadonlyMap<StageId, StageStatus>;
	loopIteration?: LoopIterationProgress;
	compact?: boolean;
}): string {
	const nodes = progressNodes(input.mode, input.profiles);
	const completedNodes = nodes.filter((node) => input.statuses.get(node.id) === "succeeded").length;
	const running = nodes.find((node) => input.statuses.get(node.id) === "running");
	const failed = nodes.find((node) => input.statuses.get(node.id) === "failed");
	const next = nodes.find((node) => input.statuses.get(node.id) === "pending");
	const activeAgent = nodes
		.flatMap((node) => node.agentIds)
		.find((agentId) => input.statuses.get(agentId) === "running");
	const failedAgent = nodes
		.flatMap((node) => node.agentIds)
		.find((agentId) => input.statuses.get(agentId) === "failed");
	let activeLabel: string;
	if (activeAgent) activeLabel = workflowStageLabel(input.mode, input.profiles, activeAgent);
	else if (failedAgent) activeLabel = `${workflowStageLabel(input.mode, input.profiles, failedAgent)}（失败）`;
	else if (running) activeLabel = running.label;
	else if (failed) activeLabel = `${failed.label}（失败）`;
	else activeLabel = next?.label ?? (completedNodes === nodes.length ? "全部节点已完成" : "等待下一节点");
	const currentNode = running?.label
		?? (failed ? `${failed.label}（失败）` : undefined)
		?? next?.label
		?? (completedNodes === nodes.length ? "工作流完成" : "工作流已停止");
	const percentage = nodes.length === 0 ? 0 : Math.floor((completedNodes / nodes.length) * 100);
	const iteration = input.loopIteration && running?.id === input.loopIteration.loopId
		? ` · 第 ${input.loopIteration.iteration}/${input.loopIteration.maxIterations} 轮`
		: "";
	const currentCompleted = running ? completedAgentSteps(running, input.statuses) : 0;
	const currentProgressLabel = running?.agentIds.length === 1 ? "节点 Agent 进度" : "本轮 Agent 进度";
	const currentProgress = running
		? `${tuiStyle.title(currentProgressLabel)}  ${progressBar(currentCompleted, running.agentIds.length)}  ${currentCompleted}/${running.agentIds.length} Agent`
		: undefined;
	const styledCurrentNode = running
		? tuiStyle.running(`${currentNode}${iteration}`)
		: failed
			? tuiStyle.failed(currentNode)
			: `${currentNode}${iteration}`;
	const styledActiveAgent = activeAgent
		? tuiStyle.running(activeLabel)
		: failedAgent || failed
			? tuiStyle.failed(activeLabel)
			: activeLabel;

	if (input.compact) {
		return [
			tuiStyle.accent("━━ 研发工作进展 ━━"),
			`${tuiStyle.title("整体")}  ${completedNodes}/${nodes.length} 节点 · ${percentage}%`,
			`${tuiStyle.title("节点")}  ${styledCurrentNode}`,
			`${tuiStyle.title("Agent")}  ${styledActiveAgent}`,
			...(running ? [`${tuiStyle.title(running.agentIds.length === 1 ? "节点" : "本轮")}  ${currentCompleted}/${running.agentIds.length} Agent`] : []),
		].join("\n");
	}

	const summary = [
		tuiStyle.accent("┏━━ 研发工作进展 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"),
		`${tuiStyle.title("整体进度")}  ${progressBar(completedNodes, nodes.length)}  ${completedNodes}/${nodes.length} 节点 · ${percentage}%`,
		`${tuiStyle.title("当前节点")}  ${styledCurrentNode}`,
		`${tuiStyle.title("当前 Agent")}  ${styledActiveAgent}`,
		...(currentProgress ? [currentProgress] : []),
	];
	return [
		...summary,
		"",
		tuiStyle.title("执行路径"),
		...nodes.flatMap((node, index) => nodeLines(node, index, input)),
		tuiStyle.accent("┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"),
	].join("\n");
}

function progressNodes(mode: RobotDevelopmentMode, profiles: readonly AgentProfile[]): readonly ProgressNode[] {
	return [
		...mode.loops.flatMap((loop) => [
			{
				id: loop.id,
				label: loop.name,
				agentIds: [loop.testAgentId, loop.codingAgentId, loop.verificationAgentId],
			},
			...(loop.deploymentAgentId
				? [{ id: loop.deploymentAgentId, label: workflowStageLabel(mode, profiles, loop.deploymentAgentId), agentIds: [loop.deploymentAgentId] }]
				: []),
		]),
		...mode.deliveryAgentIds.map((agentId) => ({ id: agentId, label: workflowStageLabel(mode, profiles, agentId), agentIds: [agentId] })),
		...mode.acceptanceAgentIds.map((agentId) => ({ id: agentId, label: workflowStageLabel(mode, profiles, agentId), agentIds: [agentId] })),
	];
}

function nodeLines(
	node: ProgressNode,
	index: number,
	input: Parameters<typeof workflowProgressReport>[0],
): readonly string[] {
	const status = input.statuses.get(node.id) ?? "pending";
	const loop = input.mode.loops.find((candidate) => candidate.id === node.id);
	const suffix = loop && input.loopIteration?.loopId === loop.id
		? ` · 第 ${input.loopIteration.iteration}/${input.loopIteration.maxIterations} 轮`
		: "";
	const lines = [`${stageMarker(status)} ${index + 1}. ${node.label}${suffix}`];
	if (loop) {
		for (const agentId of node.agentIds) {
			const agentStatus = input.statuses.get(agentId) ?? "pending";
			lines.push(`  ${stageMarker(agentStatus)} ${workflowStageLabel(input.mode, input.profiles, agentId)}`);
		}
	}
	return lines;
}

function progressBar(completed: number, total: number): string {
	const width = 18;
	const filled = total === 0 ? 0 : Math.round((completed / total) * width);
	return `[${tuiStyle.succeeded("█".repeat(filled))}${tuiStyle.pending("░".repeat(width - filled))}]`;
}

function completedAgentSteps(node: ProgressNode, statuses: ReadonlyMap<StageId, StageStatus>): number {
	if (statuses.get(node.id) === "succeeded") return node.agentIds.length;
	return node.agentIds.filter((agentId) => statuses.get(agentId) === "succeeded").length;
}
