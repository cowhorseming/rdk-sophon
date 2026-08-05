import {
	Editor,
	type EditorTheme,
	matchesKey,
	ProcessTerminal,
	Text,
	TUI,
} from "@earendil-works/pi-tui";
import { RouteUserRequest, type RoutedUserRequest } from "../../application/route-user-request.ts";
import { RunOrchestration } from "../../application/run-orchestration.ts";
import type { AgentProfile } from "../../domain/agent-profile.ts";
import { modeAgentIds, type OrchestrationMode } from "../../domain/orchestration-mode.ts";
import type { StageId, StageStatus } from "../../domain/workflow.ts";
import { PiAgentRunner } from "../../infra/pi-agent-runner.ts";
import { PiRequestIntentClassifier } from "../../infra/pi-request-intent-classifier.ts";
import type { ResolvedWorkspace } from "../../infra/managed-workspace.ts";
import { inspectDevelopmentWorkspace } from "../../infra/workspace-preflight.ts";
import type { AgentConfiguration } from "../../shared/agent-configuration.ts";
import type { AgentSkillInfo } from "../../shared/agent-runner.ts";
import type { HumanInputRequest, HumanInputResponse } from "../../shared/human-in-loop.ts";
import type { RequestRoutingEvent } from "../../shared/request-intent-classifier.ts";
import type { WorkflowEvent } from "../../shared/workflow-events.ts";
import { adjacentModeId, modeSwitchDirection } from "./mode-navigation.ts";
import { profileSkillStatus, skillReport } from "./skill-view.ts";
import { agentEndBanner, agentLifecycleLogEntry, agentStartBanner, stageMarker, tuiStyle } from "./tui-style.ts";
import {
	type LoopIterationProgress,
	shouldDisplayAgentLifecycle,
	shouldDisplayWorkflowProgress,
	workflowProgressReport,
	workflowStageLabel,
} from "./workflow-progress.ts";

const plain = (text: string): string => text;
const editorTheme: EditorTheme = {
	borderColor: plain,
	selectList: {
		selectedPrefix: plain,
		selectedText: plain,
		description: plain,
		scrollInfo: plain,
		noMatch: plain,
	},
};

type AppPhase = "idle" | "classifying" | "awaiting-intent" | "orchestrating";

export class OrchestrationApp {
	private readonly workspaceRoot: string;
	private readonly workspace: ResolvedWorkspace;
	private readonly configuration: AgentConfiguration;
	private readonly terminal = new ProcessTerminal();
	private readonly tui = new TUI(this.terminal);
	private readonly header = new Text("", 1, 0);
	private readonly stages = new Text("", 1, 0);
	private readonly transcript = new Text("", 1, 0);
	private readonly progress = new Text("", 1, 0);
	private readonly footer = new Text("", 1, 0);
	private readonly editor = new Editor(this.tui, editorTheme, { paddingX: 1 });
	private readonly statuses: Map<StageId, StageStatus>;
	private readonly loadedSkills = new Map<StageId, readonly AgentSkillInfo[]>();
	private readonly selectedSkills = new Map<StageId, AgentSkillInfo[]>();
	private readonly agentStartedAt = new Map<StageId, number>();
	private readonly runOrchestration: RunOrchestration;
	private readonly routeUserRequest: RouteUserRequest;
	private selectedModeId: string;
	private humanWaiter?: { request: HumanInputRequest; resolve: (response: HumanInputResponse) => void };
	private pendingIntent?: { request: string; context: string[] };
	private loopIteration?: LoopIterationProgress;
	private log: string;
	private phase: AppPhase = "idle";
	private lastWorkflowVisible = false;

	constructor(workspace: ResolvedWorkspace, configuration: AgentConfiguration) {
		this.workspace = workspace;
		this.workspaceRoot = workspace.root;
		this.configuration = configuration;
		this.log = workspace.created ? `已从内置模板初始化${workspace.description}。\n` : "";
		this.selectedModeId = configuration.defaultModeId;
		this.statuses = new Map();
		this.resetStatuses();
		this.runOrchestration = new RunOrchestration(new PiAgentRunner(), configuration.profiles);
		this.routeUserRequest = new RouteUserRequest(
			new PiRequestIntentClassifier(this.workspaceRoot, configuration.intake.timeoutSeconds),
			configuration.intake,
		);
		this.editor.onSubmit = (value) => void this.submit(value);
		this.tui.addInputListener((data) => {
			if (matchesKey(data, "ctrl+c")) {
				this.stop();
				return { consume: true };
			}
			const direction = modeSwitchDirection(data);
			if (direction !== 0) {
				if (this.phase === "idle" && !this.humanWaiter) this.switchMode(direction);
				return { consume: true };
			}
			return undefined;
		});
		this.layout();
		this.tui.setFocus(this.editor);
		this.refresh();
	}

	start(): void {
		this.tui.start();
	}

	private layout(): void {
		this.tui.addChild(this.header);
		this.tui.addChild(this.stages);
		this.tui.addChild(this.transcript);
		// Keep progress next to the editor so long Agent logs cannot scroll it out of view.
		this.tui.addChild(this.progress);
		this.tui.addChild(this.editor);
		this.tui.addChild(this.footer);
	}

	private async submit(value: string): Promise<void> {
		const request = value.trim();
		if (!request) return;
		if (request === "/quit") {
			this.stop();
			return;
		}
		if (this.humanWaiter) {
			const waiter = this.humanWaiter;
			this.humanWaiter = undefined;
			this.editor.addToHistory(request);
			this.editor.setText("");
			this.editor.disableSubmit = true;
			waiter.resolve({ action: request === "/abort" ? "abort" : "continue", message: request });
			this.refresh();
			return;
		}
		if (this.pendingIntent) {
			this.editor.addToHistory(request);
			this.editor.setText("");
			if (request === "/abort") {
				this.pendingIntent = undefined;
				this.phase = "idle";
				this.log += "\n已取消本次研发意图确认，研发流程未启动。\n";
				this.refresh();
				return;
			}
			const pending = this.pendingIntent;
			this.pendingIntent = undefined;
			await this.handleUserRequest(pending.request, [...pending.context, request], false);
			return;
		}
		if (request === "/clear") {
			this.log = "";
			this.refresh();
			return;
		}
		if (request === "/modes") {
			this.log += `${this.configuration.modes.map((mode) => `${mode.id === this.selectedModeId ? "*" : " "} ${mode.id} — ${mode.name}`).join("\n")}\n`;
			this.editor.setText("");
			this.refresh();
			return;
		}
		if (request === "/skills") {
			this.log += `${skillReport(this.activeProfiles(this.mode()), this.loadedSkills, this.selectedSkills)}\n`;
			this.editor.setText("");
			this.refresh();
			return;
		}
		if (request === "/workspace") {
			this.log += `当前工作区：${this.workspace.description}\n来源：${this.workspace.kind === "managed" ? "rdk-agent 内置版本化模板；无需下载 rdk-sophon 源码" : "用户显式提供的外部源码"}\n`;
			this.editor.setText("");
			this.refresh();
			return;
		}
		if (request.startsWith("/mode ")) {
			const modeId = request.slice(6).trim();
			const mode = this.configuration.modes.find((candidate) => candidate.id === modeId);
			this.editor.setText("");
			if (!mode) this.log += `未知模式：${modeId}。输入 /modes 查看可用模式。\n`;
			else this.selectMode(mode.id);
			this.refresh();
			return;
		}
		if (request === "/develop") {
			this.log += "用法：/develop <用户指令>\n";
			this.editor.setText("");
			this.refresh();
			return;
		}
		if (this.phase !== "idle") return;
		const forceDevelopment = request.startsWith("/develop ");
		const routedRequest = forceDevelopment ? request.slice("/develop ".length).trim() : request;
		if (!routedRequest) return;
		this.editor.addToHistory(request);
		this.editor.setText("");
		await this.handleUserRequest(routedRequest, [], forceDevelopment);
	}

	private async handleUserRequest(request: string, conversationContext: readonly string[], forceDevelopment: boolean): Promise<void> {
		this.lastWorkflowVisible = false;
		const selectedMode = this.mode();
		if (selectedMode.type !== "robot-development") {
			if (forceDevelopment) {
				this.log += "当前不是机器人研发模式；请先用 /mode robot-development 切换模式。\n";
				this.editor.disableSubmit = false;
				this.refresh();
				return;
			}
			await this.runWorkflow(selectedMode, request);
			return;
		}

		this.phase = "classifying";
		this.editor.disableSubmit = true;
		if (conversationContext.length === 0) this.log = `用户指令：${request}\n`;
		else this.log += `\n[意图确认补充] ${conversationContext.at(-1)}\n`;
		this.refresh();
		let decision: RoutedUserRequest;
		try {
			decision = await this.routeUserRequest.execute({
				request,
				mode: selectedMode,
				conversationContext,
				forceDevelopment,
				onEvent: (event) => this.handleRoutingEvent(event),
			});
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			decision = {
				kind: "clarification",
				confidence: 0,
				question: "意图识别暂时不可用。你是否要启动研发流程并修改机器人动作能力？",
				reasonCode: "routing-failed",
			};
			this.log += `\n[意图识别异常] ${detail}\n`;
		}

		if (decision.kind === "development") {
			this.log += `\n[输入识别] 已确认该用户指令需要启动研发流程 · 置信度 ${formatConfidence(decision.confidence)}\n`;
			await this.runWorkflow(selectedMode, authorizedDevelopmentRequest(request, conversationContext));
			return;
		}
		if (decision.kind === "conversation") {
			this.log += `\n[输入识别] 非研发对话 · ${decision.userMessage ?? "研发流程未启动。"}\n`;
			this.phase = "idle";
			this.editor.disableSubmit = false;
			this.refresh();
			return;
		}
		if (decision.kind === "unsupported-development") {
			this.log += `\n[输入识别] 当前研发流程不支持：${decision.reason}\n研发流程未启动。\n`;
			this.phase = "idle";
			this.editor.disableSubmit = false;
			this.refresh();
			return;
		}

		this.pendingIntent = { request, context: [...conversationContext] };
		this.phase = "awaiting-intent";
		this.editor.disableSubmit = false;
		this.log += `\n[需要确认研发意图] ${decision.question}\n输入补充信息后按 Enter，或输入 /abort 取消。\n`;
		this.refresh();
	}

	private async runWorkflow(mode: OrchestrationMode, request: string): Promise<void> {
		if (mode.type === "robot-development") {
			const problem = inspectDevelopmentWorkspace(this.workspaceRoot, this.configuration.workspace.requiredPaths);
			if (problem) {
				this.phase = "idle";
				this.editor.disableSubmit = false;
				this.log = `开发工作区校验失败。\n当前 workspace：${problem.root}\n缺少：${problem.missingPaths.join(", ")}${problem.suggestedRoot ? `\n检测到正确项目：${problem.suggestedRoot}\n请退出后执行：rdk-agent --workspace ${problem.suggestedRoot}` : ""}\n`;
				this.refresh();
				return;
			}
		}

		this.phase = "orchestrating";
		this.editor.disableSubmit = true;
		this.resetStatuses();
		this.log += `\n用户指令：${request}\n\n`;
		this.refresh();
		try {
			await this.runOrchestration.execute({
				mode,
				request,
				workspaceRoot: this.workspaceRoot,
				skillDirectory: this.configuration.skillDirectory,
				humanInLoop: { requestInput: (humanRequest) => this.waitForHuman(humanRequest) },
				onEvent: (event) => this.handleEvent(event),
			});
		} finally {
			this.phase = "idle";
			this.lastWorkflowVisible = true;
			this.editor.disableSubmit = false;
			this.refresh();
		}
	}

	private handleRoutingEvent(event: RequestRoutingEvent): void {
		if (event.type === "intent-classification-started") this.log += "\n[输入识别] 意图分类 Agent 正在判断……\n";
		if (event.type === "intent-classification-failed") this.log += `\n[输入识别失败] ${event.detail}\n`;
		this.refresh();
	}

	private handleEvent(event: WorkflowEvent): void {
		if (event.type === "stage-status") {
			const previous = this.statuses.get(event.stageId);
			const profile = this.configuration.profiles.find((candidate) => candidate.id === event.stageId);
			const now = Date.now();
			const showLifecycle = shouldDisplayAgentLifecycle(this.mode());
			this.statuses.set(event.stageId, event.status);
			if (showLifecycle && profile && event.status === "running" && previous !== "running") {
				this.agentStartedAt.set(event.stageId, now);
				this.log += agentLifecycleLogEntry(agentStartBanner(profile.name, now));
			} else if (showLifecycle && profile && (event.status === "succeeded" || event.status === "failed") && previous === "running") {
				this.log += agentLifecycleLogEntry(agentEndBanner(profile.name, event.status, now, this.agentStartedAt.get(event.stageId)));
				this.agentStartedAt.delete(event.stageId);
			} else if (showLifecycle && !profile && event.status === "running" && previous !== "running") {
				this.log += `\n\n${tuiStyle.accent(`>>> 进入工作节点：${workflowStageLabel(this.mode(), this.configuration.profiles, event.stageId)}`)}\n\n`;
			}
			if (showLifecycle && event.detail) this.log += `\n[${event.stageId}] ${event.detail}\n`;
		}
		if (event.type === "loop-iteration") {
			const activeMode = this.mode();
			if (event.iteration > 1 && activeMode.type === "robot-development") {
				const loop = activeMode.loops.find((candidate) => candidate.id === event.loopId);
				if (loop) {
					for (const agentId of [loop.testAgentId, loop.codingAgentId, loop.verificationAgentId]) {
						this.statuses.set(agentId, "pending");
					}
				}
			}
			this.loopIteration = event;
			this.log += `\n\n${tuiStyle.warning(`[${event.loopName}] 第 ${event.iteration}/${event.maxIterations} 次迭代`)}\n\n`;
		}
		if (event.type === "agent-event") this.log += event.text;
		if (event.type === "skills-loaded") {
			this.loadedSkills.set(event.stageId, event.skills);
			this.log += `\n[Skill 已加载] ${event.skills.map((skill) => skill.name).join(", ") || "无"}\n`;
		}
		if (event.type === "skill-selected") {
			const selected = this.selectedSkills.get(event.stageId) ?? [];
			if (!selected.some((skill) => skill.name === event.skill.name)) selected.push(event.skill);
			this.selectedSkills.set(event.stageId, selected);
			this.log += `\n[Skill 已选择] ${event.skill.name}\n`;
		}
		if (event.type === "human-input-received") this.log += `\n[人类输入] ${event.message}\n`;
		if (event.type === "workflow-finished") {
			const finished = `${event.succeeded ? "验收通过" : "流程中止"}：${event.detail}`;
			this.log += `\n\n${event.succeeded ? tuiStyle.succeeded(finished) : tuiStyle.failed(finished)}\n`;
		}
		this.refresh();
	}

	private refresh(): void {
		const mode = this.mode();
		const workflowVisible = this.phase === "orchestrating" || (this.phase === "idle" && this.lastWorkflowVisible);
		const showWorkflowProgress = shouldDisplayWorkflowProgress(mode, workflowVisible);
		const phaseStatus = mode.type !== "robot-development"
			? ""
			: showWorkflowProgress
				? workflowProgressReport({
					mode,
					profiles: this.configuration.profiles,
					statuses: this.statuses,
					loopIteration: this.loopIteration,
					compact: this.terminal.rows < 32 || this.terminal.columns < 80,
				})
				: this.phase === "classifying"
					? "输入识别  ▶ 意图分类 Agent 正在判断；研发流程尚未启动。"
					: this.phase === "awaiting-intent"
						? "输入识别  △ 等待确认；研发流程尚未启动。"
						: "输入用户指令后会先辨识意图；只有明确要求研发的用户指令才启动工作流。";
		this.header.setText(tuiStyle.title(`RDK Agent Orchestrator · ${mode.name} · ${this.workspace.kind === "managed" ? "托管工程" : "外部工程"}`));
		this.stages.setText(
			mode.type === "robot-development" && !showWorkflowProgress
				? this.activeProfiles(mode).map((profile: AgentProfile) => this.profileStatus(profile)).join("\n")
				: "",
		);
		this.transcript.setText(this.log || "请输入用户指令后按 Enter 开始执行。");
		this.progress.setText(phaseStatus);
		this.footer.setText(
			this.humanWaiter
				? "等待人类输入 · Enter 继续 · /abort 终止"
				: this.phase === "classifying"
					? "正在辨识输入；意图分类 Agent 无工具和工作区写权限。"
					: this.phase === "awaiting-intent"
						? "等待研发意图确认 · Enter 补充 · /abort 取消"
						: this.phase === "orchestrating"
							? "正在执行；日志区可滚动查看。"
							: `模式：${mode.id} · Shift+Tab 切换${mode.type === "robot-development" ? " · /develop <用户指令> 强制研发" : ""} · /workspace · /skills · /modes · /mode <id> · /quit`,
		);
		this.tui.requestRender();
	}

	private waitForHuman(request: HumanInputRequest): Promise<HumanInputResponse> {
		this.log += `\n[需要人类接入] ${request.agentName}\n问题：${request.question}\n上下文：${request.context}\n`;
		this.editor.disableSubmit = false;
		this.refresh();
		return new Promise((resolve) => {
			this.humanWaiter = { request, resolve };
			this.refresh();
		});
	}

	private mode(): OrchestrationMode {
		const mode = this.configuration.modes.find((candidate) => candidate.id === this.selectedModeId);
		if (!mode) throw new Error(`模式配置不存在：${this.selectedModeId}`);
		return mode;
	}

	private activeProfiles(mode: OrchestrationMode): readonly AgentProfile[] {
		const ids = new Set(modeAgentIds(mode));
		return this.configuration.profiles.filter((profile) => ids.has(profile.id));
	}

	private profileStatus(profile: AgentProfile): string {
		const statusValue = this.statuses.get(profile.id) ?? "pending";
		const status = `${stageMarker(statusValue)} ${profile.name}：${profile.description}`;
		const skillStatus = profileSkillStatus(profile, this.loadedSkills.get(profile.id), this.selectedSkills.get(profile.id));
		return skillStatus ? `${status}\n  ${skillStatus}` : status;
	}

	private switchMode(direction: -1 | 1): void {
		this.selectMode(adjacentModeId(this.configuration.modes, this.selectedModeId, direction));
		this.refresh();
	}

	private selectMode(modeId: string): void {
		if (modeId === this.selectedModeId) return;
		this.selectedModeId = modeId;
		this.lastWorkflowVisible = false;
		this.resetStatuses();
		this.log += `已切换到 ${this.mode().name}。\n`;
	}

	private resetStatuses(): void {
		this.statuses.clear();
		this.loadedSkills.clear();
		this.selectedSkills.clear();
		this.agentStartedAt.clear();
		this.loopIteration = undefined;
		for (const agentId of modeAgentIds(this.mode())) this.statuses.set(agentId, "pending");
	}

	private stop(): void {
		this.tui.stop();
		process.exit(0);
	}
}

function formatConfidence(confidence: number): string {
	return `${Math.round(confidence * 100)}%`;
}

function authorizedDevelopmentRequest(request: string, conversationContext: readonly string[]): string {
	if (conversationContext.length === 0) return request;
	return [request, ...conversationContext.map((message) => `用户澄清：${message}`)].join("\n");
}
