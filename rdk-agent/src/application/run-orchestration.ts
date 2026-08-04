import type { AgentProfile } from "../domain/agent-profile.ts";
import type { OrchestrationMode, RobotApplicationMode, RobotDevelopmentMode, TddLoopDefinition } from "../domain/orchestration-mode.ts";
import { DeliveryWorkflow, type WorkflowStage } from "../domain/workflow.ts";
import type { AgentExpectation, AgentRunResult, AgentRunner, Delivery } from "../shared/agent-runner.ts";
import type { HumanInLoop, HumanInputResponse } from "../shared/human-in-loop.ts";
import type { WorkflowEvent } from "../shared/workflow-events.ts";

export interface RunOrchestrationInput {
	mode: OrchestrationMode;
	request: string;
	workspaceRoot: string;
	skillDirectory: string;
	humanInLoop: HumanInLoop;
	onEvent: (event: WorkflowEvent) => void;
}

export interface RunOrchestrationResult {
	modeId: string;
	stages: readonly WorkflowStage[];
	succeeded: boolean;
}

class HumanAbortedError extends Error {}

function visibleToolResult(result: string): string {
	const limit = 2_000;
	if (result.length <= limit) return result;
	const firstLine = result.slice(0, result.indexOf("\n") < 0 ? result.length : result.indexOf("\n"));
	const marker = firstLine.startsWith("[rdk-agent 沙箱]") ? `${firstLine}\n...\n` : "";
	return `${marker}${result.slice(-limit)}`;
}

export class RunOrchestration {
	private readonly agentRunner: AgentRunner;
	private readonly profilesById: ReadonlyMap<string, AgentProfile>;

	constructor(agentRunner: AgentRunner, profiles: readonly AgentProfile[]) {
		this.agentRunner = agentRunner;
		this.profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
	}

	async execute(input: RunOrchestrationInput): Promise<RunOrchestrationResult> {
		input.onEvent({ type: "workflow-started", request: input.request, modeId: input.mode.id, modeName: input.mode.name });
		return input.mode.type === "robot-development"
			? this.runDevelopment(input, input.mode)
			: this.runApplication(input, input.mode);
	}

	private async runDevelopment(input: RunOrchestrationInput, mode: RobotDevelopmentMode): Promise<RunOrchestrationResult> {
		const stageOrder = [
			...mode.loops.flatMap((loop) => [loop.id, ...(loop.deploymentAgentId ? [loop.deploymentAgentId] : [])]),
			...mode.acceptanceAgentIds,
		];
		const workflow = new DeliveryWorkflow(stageOrder);
		const deliveries: Delivery[] = [];

		for (const loop of mode.loops) {
			workflow.start(loop.id);
			try {
				await this.runTddLoop(input, loop, deliveries);
				const detail = `${loop.deliverable} 已通过 ${loop.name}`;
				workflow.succeed(loop.id, detail);
				deliveries.push({ stageId: loop.id, summary: detail });
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				workflow.fail(loop.id, detail);
				input.onEvent({ type: "workflow-finished", succeeded: false, detail: `${loop.name} 中止：${detail}` });
				return { modeId: mode.id, stages: workflow.snapshot(), succeeded: false };
			}
			if (loop.deploymentAgentId) {
				workflow.start(loop.deploymentAgentId);
				try {
					const deployment = await this.runAgent(input, loop.deploymentAgentId, "deployment", deliveries);
					workflow.succeed(loop.deploymentAgentId, deployment.summary);
					deliveries.push({ stageId: loop.deploymentAgentId, summary: deployment.summary });
				} catch (error) {
					const detail = error instanceof Error ? error.message : String(error);
					workflow.fail(loop.deploymentAgentId, detail);
					input.onEvent({ type: "workflow-finished", succeeded: false, detail: `${this.profile(loop.deploymentAgentId).name} 中止：${detail}` });
					return { modeId: mode.id, stages: workflow.snapshot(), succeeded: false };
				}
			}
		}

		for (const acceptanceAgentId of mode.acceptanceAgentIds) {
			workflow.start(acceptanceAgentId);
			try {
				const acceptance = await this.runAgent(input, acceptanceAgentId, "application", deliveries);
				workflow.succeed(acceptanceAgentId, acceptance.summary);
				deliveries.push({ stageId: acceptanceAgentId, summary: acceptance.summary });
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				workflow.fail(acceptanceAgentId, detail);
				input.onEvent({ type: "workflow-finished", succeeded: false, detail: `真机验收中止：${detail}` });
				return { modeId: mode.id, stages: workflow.snapshot(), succeeded: false };
			}
		}

		input.onEvent({ type: "workflow-finished", succeeded: true, detail: "Python、CLI、Skill 的 TDD、部署与真机命令链路验收均已通过；没有位置反馈时不代表物理位移已被测量。" });
		return { modeId: mode.id, stages: workflow.snapshot(), succeeded: true };
	}

	private async runTddLoop(input: RunOrchestrationInput, loop: TddLoopDefinition, deliveries: Delivery[]): Promise<void> {
		let iteration = 0;
		while (true) {
			iteration++;
			input.onEvent({ type: "loop-iteration", loopId: loop.id, loopName: loop.name, iteration, maxIterations: loop.maxIterations });

			const testResult = await this.runAgent(input, loop.testAgentId, "test", deliveries, iteration);
			deliveries.push({ stageId: loop.testAgentId, summary: testResult.summary });
			if (testResult.outcome === "revision") {
				input.onEvent({ type: "stage-status", stageId: loop.testAgentId, status: "failed", detail: testResult.feedback });
				if (iteration < loop.maxIterations) continue;
				throw new Error(`${loop.name} 测试设计达到 ${loop.maxIterations} 次自动返工上限：${testResult.feedback ?? testResult.summary}`);
			}

			const codingResult = await this.runAgent(input, loop.codingAgentId, "coding", deliveries, iteration);
			deliveries.push({ stageId: loop.codingAgentId, summary: codingResult.summary });
			if (codingResult.outcome === "revision") {
				input.onEvent({ type: "stage-status", stageId: loop.codingAgentId, status: "failed", detail: codingResult.feedback });
				if (iteration < loop.maxIterations) continue;
				throw new Error(`${loop.name} Coding 达到 ${loop.maxIterations} 次自动返工上限：${codingResult.feedback ?? codingResult.summary}`);
			}

			const verification = await this.runAgent(input, loop.verificationAgentId, "verification", deliveries, iteration);
			deliveries.push({ stageId: loop.verificationAgentId, summary: verification.summary });
			if (verification.outcome === "completed") return;

			input.onEvent({
				type: "stage-status",
				stageId: loop.verificationAgentId,
				status: "failed",
				detail: verification.feedback ?? "验证要求返工",
			});
			if (iteration < loop.maxIterations) continue;

			throw new Error(
				`${loop.name} 已达到 ${loop.maxIterations} 次自动返工上限：${verification.feedback ?? verification.summary}`,
			);
		}
	}

	private async runApplication(input: RunOrchestrationInput, mode: RobotApplicationMode): Promise<RunOrchestrationResult> {
		const workflow = new DeliveryWorkflow([mode.agentId]);
		const deliveries: Delivery[] = [];
		workflow.start(mode.agentId);
		try {
			const result = await this.runAgent(input, mode.agentId, "application", deliveries);
			workflow.succeed(mode.agentId, result.summary);
			input.onEvent({ type: "workflow-finished", succeeded: true, detail: "机器人应用效果测试完成。" });
			return { modeId: mode.id, stages: workflow.snapshot(), succeeded: true };
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			workflow.fail(mode.agentId, detail);
			input.onEvent({ type: "workflow-finished", succeeded: false, detail: `机器人应用模式中止：${detail}` });
			return { modeId: mode.id, stages: workflow.snapshot(), succeeded: false };
		}
	}

	private async runAgent(
		input: RunOrchestrationInput,
		agentId: string,
		expectation: AgentExpectation,
		deliveries: Delivery[],
		iteration?: number,
	): Promise<AgentRunResult> {
		const profile = this.profile(agentId);
		let automaticRecoveries = 0;
		const canRetryWithoutSideEffects = expectation === "test" || expectation === "coding" || expectation === "verification";
		const recordAutomaticRecovery = (detail: string): boolean => {
			if (input.mode.type !== "robot-development" || !canRetryWithoutSideEffects || automaticRecoveries >= 2) return false;
			automaticRecoveries++;
			const summary = `${profile.name} 第 ${automaticRecoveries} 次自动恢复：${detail}。请基于现有文件和上游交付自行定位并继续，不要请求人类提供可从工作区获得的信息。`;
			deliveries.push({ stageId: `${agentId}-auto-recovery`, summary });
			input.onEvent({ type: "stage-status", stageId: agentId, status: "running", detail: summary });
			return true;
		};
		while (true) {
			input.onEvent({ type: "stage-status", stageId: agentId, status: "running" });
			let result: AgentRunResult;
			try {
				result = await this.agentRunner.run({
					profile,
					userRequest: input.request,
					workspaceRoot: input.workspaceRoot,
					skillDirectory: input.skillDirectory,
					expectation,
					iteration,
					previousDeliveries: deliveries,
					onEvent: (event) => {
						if (event.type === "text") input.onEvent({ type: "agent-event", stageId: agentId, text: event.text });
						else if (event.type === "status") input.onEvent({ type: "agent-event", stageId: agentId, text: `\n[状态] ${event.message}\n` });
							else if (event.type === "tool-start") input.onEvent({ type: "agent-event", stageId: agentId, text: `\n[工具] ${event.displayName ?? event.toolName}${event.summary ? `：${event.summary}` : ""}\n` });
							else if (event.type === "tool-end") {
								const visibleResult = event.isError || event.toolName === "bash" || event.toolName === "deploy"
									? `\n${visibleToolResult(event.result)}\n`
									: "\n";
								const outcome = event.isError
									? expectation === "test" && event.toolName === "bash"
										? "（退出码非 0，等待测试 Agent 判定是否为有效红测）"
										: "（失败）"
									: "";
								input.onEvent({ type: "agent-event", stageId: agentId, text: `\n[工具完成] ${event.displayName ?? event.toolName}${outcome}${visibleResult}` });
							}
						else if (event.type === "skills-loaded") input.onEvent({ type: "skills-loaded", stageId: agentId, skills: event.skills });
						else input.onEvent({ type: "skill-selected", stageId: agentId, skill: event.skill });
					},
				});
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				if (recordAutomaticRecovery(detail)) continue;
				if (input.mode.type === "robot-development") {
					throw new Error(`${profile.name} 自动恢复失败：${detail}`);
				}
				const response = await this.requestHuman(input, agentId, profile.name, `${profile.name} 无法继续，请补充信息后重试，或输入 /abort 终止。`, detail);
				deliveries.push({ stageId: "human", summary: response.message });
				continue;
			}

			if (result.outcome === "needs-human") {
				if (recordAutomaticRecovery(result.summary)) continue;
				if (input.mode.type === "robot-development") {
					throw new Error(`${profile.name} 返回 needs-human，但研发模式不允许交互阻塞：${result.summary}`);
				}
				const response = await this.requestHuman(
					input,
					agentId,
					profile.name,
					result.question ?? `${profile.name} 需要人类补充信息，或输入 /abort 终止。`,
					result.summary,
				);
				deliveries.push({ stageId: "human", summary: response.message });
				continue;
			}
			if (result.outcome === "failed") {
				if (recordAutomaticRecovery(result.feedback ?? result.summary)) continue;
				throw new Error(`${profile.name} 失败：${result.feedback ?? result.summary}`);
			}

			input.onEvent({ type: "stage-status", stageId: agentId, status: result.outcome === "completed" ? "succeeded" : "failed", detail: result.feedback });
			return result;
		}
	}

	private async requestHuman(
		input: RunOrchestrationInput,
		stageId: string,
		agentName: string,
		question: string,
		context: string,
	): Promise<HumanInputResponse> {
		input.onEvent({ type: "human-input-required", stageId, question });
		const response = await input.humanInLoop.requestInput({ stageId, agentName, question, context });
		if (response.action === "abort") throw new HumanAbortedError(`人类终止了 ${agentName}`);
		input.onEvent({ type: "human-input-received", stageId, message: response.message });
		return response;
	}

	private profile(agentId: string): AgentProfile {
		const profile = this.profilesById.get(agentId);
		if (!profile) throw new Error(`Agent 配置不存在：${agentId}`);
		return profile;
	}
}
