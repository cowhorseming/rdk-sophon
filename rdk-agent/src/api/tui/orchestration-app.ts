import {
	Editor,
	type EditorTheme,
	matchesKey,
	ProcessTerminal,
	Text,
	TUI,
} from "@earendil-works/pi-tui";
import { RunOrchestration } from "../../application/run-orchestration.ts";
import type { AgentProfile } from "../../domain/agent-profile.ts";
import { modeAgentIds, type OrchestrationMode } from "../../domain/orchestration-mode.ts";
import type { StageId, StageStatus } from "../../domain/workflow.ts";
import { PiAgentRunner } from "../../infra/pi-agent-runner.ts";
import type { ResolvedWorkspace } from "../../infra/managed-workspace.ts";
import { inspectDevelopmentWorkspace } from "../../infra/workspace-preflight.ts";
import type { AgentConfiguration } from "../../shared/agent-configuration.ts";
import type { AgentSkillInfo } from "../../shared/agent-runner.ts";
import type { HumanInputRequest, HumanInputResponse } from "../../shared/human-in-loop.ts";
import type { WorkflowEvent } from "../../shared/workflow-events.ts";
import { adjacentModeId, modeSwitchDirection } from "./mode-navigation.ts";
import { profileSkillStatus, skillReport } from "./skill-view.ts";

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

const stageMarkers: Record<StageStatus, string> = {
	pending: "○",
	running: "●",
	succeeded: "✓",
	failed: "✗",
};

export class OrchestrationApp {
	private readonly workspaceRoot: string;
	private readonly workspace: ResolvedWorkspace;
	private readonly configuration: AgentConfiguration;
	private readonly terminal = new ProcessTerminal();
	private readonly tui = new TUI(this.terminal);
	private readonly header = new Text("", 1, 0);
	private readonly stages = new Text("", 1, 0);
	private readonly transcript = new Text("", 1, 0);
	private readonly footer = new Text("", 1, 0);
	private readonly editor = new Editor(this.tui, editorTheme, { paddingX: 1 });
	private readonly statuses: Map<StageId, StageStatus>;
	private readonly loadedSkills = new Map<StageId, readonly AgentSkillInfo[]>();
	private readonly selectedSkills = new Map<StageId, AgentSkillInfo[]>();
	private readonly runOrchestration: RunOrchestration;
	private selectedModeId: string;
	private humanWaiter?: { request: HumanInputRequest; resolve: (response: HumanInputResponse) => void };
	private log: string;
	private running = false;

	constructor(workspace: ResolvedWorkspace, configuration: AgentConfiguration) {
		this.workspace = workspace;
		this.workspaceRoot = workspace.root;
		this.configuration = configuration;
		this.log = workspace.created ? `已从内置模板初始化${workspace.description}。\n` : "";
		this.selectedModeId = configuration.defaultModeId;
		this.statuses = new Map();
		this.resetStatuses();
		this.runOrchestration = new RunOrchestration(new PiAgentRunner(), configuration.profiles);
		this.editor.onSubmit = (value) => void this.submit(value);
		this.tui.addInputListener((data) => {
			if (matchesKey(data, "ctrl+c")) {
				this.stop();
				return { consume: true };
			}
			const direction = modeSwitchDirection(data);
			if (direction !== 0) {
				if (!this.running && !this.humanWaiter) this.switchMode(direction);
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
		if (this.running) return;
		const selectedMode = this.mode();
		if (selectedMode.type === "robot-development") {
			const problem = inspectDevelopmentWorkspace(this.workspaceRoot, this.configuration.workspace.requiredPaths);
			if (problem) {
				this.editor.addToHistory(request);
				this.editor.setText("");
				this.log = `开发工作区校验失败。\n当前 workspace：${problem.root}\n缺少：${problem.missingPaths.join(", ")}${problem.suggestedRoot ? `\n检测到正确项目：${problem.suggestedRoot}\n请退出后执行：rdk-agent --workspace ${problem.suggestedRoot}` : ""}\n`;
				this.refresh();
				return;
			}
		}

		this.running = true;
		this.editor.disableSubmit = true;
		this.editor.addToHistory(request);
		this.editor.setText("");
		this.resetStatuses();
		this.log = `需求：${request}\n\n`;
		this.refresh();

		try {
			await this.runOrchestration.execute({
				mode: selectedMode,
				request,
				workspaceRoot: this.workspaceRoot,
				skillDirectory: this.configuration.skillDirectory,
				humanInLoop: { requestInput: (humanRequest) => this.waitForHuman(humanRequest) },
				onEvent: (event) => this.handleEvent(event),
			});
		} finally {
			this.running = false;
			this.editor.disableSubmit = false;
			this.refresh();
		}
	}

	private handleEvent(event: WorkflowEvent): void {
		if (event.type === "stage-status") {
			this.statuses.set(event.stageId, event.status);
			if (event.detail) this.log += `\n[${event.stageId}] ${event.detail}\n`;
		}
		if (event.type === "loop-iteration") this.log += `\n[${event.loopName}] 第 ${event.iteration}/${event.maxIterations} 次迭代\n`;
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
		if (event.type === "workflow-finished") this.log += `\n\n${event.succeeded ? "验收通过" : "流程中止"}：${event.detail}\n`;
		this.refresh();
	}

	private refresh(): void {
		const mode = this.mode();
		this.header.setText(`RDK Agent Orchestrator · ${mode.name} · ${this.workspace.kind === "managed" ? "托管工程" : "外部工程"}`);
		this.stages.setText(
			this.activeProfiles(mode).map((profile: AgentProfile) => this.profileStatus(profile)).join("\n"),
		);
		this.transcript.setText(this.log || "请输入自然语言需求后按 Enter 开始编排。");
		this.footer.setText(
			this.humanWaiter
				? "等待人类输入 · Enter 继续 · /abort 终止"
				: this.running
					? "正在执行；日志区可滚动查看。"
					: `模式：${mode.id} · Shift+Tab 切换 · /workspace · /skills · /modes · /mode <id> · /quit`,
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
		const status = `${stageMarkers[this.statuses.get(profile.id) ?? "pending"]} ${profile.name}：${profile.description}`;
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
		this.resetStatuses();
		this.log += `已切换到 ${this.mode().name}。\n`;
	}

	private resetStatuses(): void {
		this.statuses.clear();
		this.loadedSkills.clear();
		this.selectedSkills.clear();
		for (const agentId of modeAgentIds(this.mode())) this.statuses.set(agentId, "pending");
	}

	private stop(): void {
		this.tui.stop();
		process.exit(0);
	}
}
