import assert from "node:assert/strict";
import test from "node:test";
import { RunOrchestration } from "../../src/application/run-orchestration.ts";
import type { AgentProfile } from "../../src/domain/agent-profile.ts";
import type { RobotApplicationMode, RobotDevelopmentMode } from "../../src/domain/orchestration-mode.ts";
import type { AgentRunner } from "../../src/shared/agent-runner.ts";
import type { HumanInLoop } from "../../src/shared/human-in-loop.ts";
import type { WorkflowEvent } from "../../src/shared/workflow-events.ts";

const profiles: readonly AgentProfile[] = ["test", "coding", "verification", "deployment", "application"].map((id) => ({
	id,
	name: id,
	description: id,
	tools: [],
	skills: [],
	systemPrompt: id,
	writePaths: [],
	timeoutSeconds: 60,
	maxToolCalls: 5,
}));

const developmentMode: RobotDevelopmentMode = {
	id: "robot-development",
	name: "机器人开发模式",
	type: "robot-development",
	loops: [
		{
			id: "python",
			name: "Python TDD",
			deliverable: "Python script",
			testAgentId: "test",
			codingAgentId: "coding",
			verificationAgentId: "verification",
			maxIterations: 3,
		},
	],
	acceptanceAgentIds: [],
};

const applicationMode: RobotApplicationMode = {
	id: "robot-application",
	name: "机器人应用模式",
	type: "robot-application",
	agentId: "application",
};

const noHuman: HumanInLoop = {
	async requestInput() {
		throw new Error("human input was not expected");
	},
};

test("TDD loop repeats test, coding and verification until verification passes", async () => {
	const calls: string[] = [];
	const expectations: string[] = [];
	let verificationCount = 0;
	const runner: AgentRunner = {
		async run(request) {
			calls.push(request.profile.id);
			expectations.push(request.expectation);
			if (request.expectation === "verification" && ++verificationCount === 1) {
				return { summary: "test failed", outcome: "revision", feedback: "fix boundary" };
			}
			return { summary: `${request.profile.id} done`, outcome: "completed" };
		},
	};
	const events: WorkflowEvent[] = [];
	const result = await new RunOrchestration(runner, profiles).execute({
		mode: developmentMode,
		request: "新增摇头指令",
		workspaceRoot: "/tmp/rdk",
		skillDirectory: "/tmp/skills",
		humanInLoop: noHuman,
		onEvent: (event) => events.push(event),
	});

	assert.deepEqual(calls, ["test", "coding", "verification", "test", "coding", "verification"]);
	assert.deepEqual(expectations, ["test", "coding", "verification", "test", "coding", "verification"]);
	assert.equal(result.succeeded, true);
	assert.equal(events.filter((event) => event.type === "loop-iteration").length, 2);
});

test("development automatically retries a transient Agent failure without human input", async () => {
	const calls: string[] = [];
	let failed = false;
	const runner: AgentRunner = {
		async run(request) {
			calls.push(request.profile.id);
			if (request.expectation === "test" && !failed) {
				failed = true;
				throw new Error("stage timeout");
			}
			return { summary: `${request.profile.id} done`, outcome: "completed" };
		},
	};
	const events: WorkflowEvent[] = [];
	const result = await new RunOrchestration(runner, profiles).execute({
		mode: developmentMode,
		request: "开发一个挥动右手的功能",
		workspaceRoot: "/tmp/rdk",
		skillDirectory: "/tmp/skills",
		humanInLoop: noHuman,
		onEvent: (event) => events.push(event),
	});

	assert.equal(result.succeeded, true);
	assert.deepEqual(calls, ["test", "test", "coding", "verification"]);
	assert.ok(events.some((event) => event.type === "stage-status" && event.detail?.includes("第 1 次自动恢复")));
});

test("an explicit failed result ends a side-effecting stage without human input", async () => {
	const runner: AgentRunner = {
		async run() {
			return { summary: "device command failed", outcome: "failed", feedback: "exit 7" };
		},
	};
	const result = await new RunOrchestration(runner, profiles).execute({
		mode: applicationMode,
		request: "挥动右手",
		workspaceRoot: "/tmp/rdk",
		skillDirectory: "/tmp/skills",
		humanInLoop: noHuman,
		onEvent: () => undefined,
	});
	assert.equal(result.succeeded, false);
	assert.match(result.stages[0]?.detail ?? "", /exit 7/);
});

test("development fails explicitly instead of requesting human after unsafe needs-human", async () => {
	const runner: AgentRunner = {
		async run(request) {
			if (request.expectation === "deployment") {
				return { summary: "board unavailable", outcome: "needs-human", question: "请检查板子" };
			}
			return { summary: "done", outcome: "completed" };
		},
	};
	const mode: RobotDevelopmentMode = {
		...developmentMode,
		loops: [{ ...developmentMode.loops[0]!, deploymentAgentId: "deployment" }],
	};
	const result = await new RunOrchestration(runner, profiles).execute({
		mode,
		request: "开发一个挥动右手的功能",
		workspaceRoot: "/tmp/rdk",
		skillDirectory: "/tmp/skills",
		humanInLoop: noHuman,
		onEvent: () => undefined,
	});

	assert.equal(result.succeeded, false);
	assert.match(result.stages.find((stage) => stage.id === "deployment")?.detail ?? "", /不允许交互阻塞/);
});

test("development runs deterministic deployment and final acceptance after a passing TDD loop", async () => {
	const calls: string[] = [];
	const expectations: string[] = [];
	const runner: AgentRunner = {
		async run(request) {
			calls.push(request.profile.id);
			expectations.push(request.expectation);
			return { summary: `${request.profile.id} done`, outcome: "completed" };
		},
	};
	const mode: RobotDevelopmentMode = {
		...developmentMode,
		loops: [{ ...developmentMode.loops[0]!, deploymentAgentId: "deployment" }],
		acceptanceAgentIds: ["application"],
	};
	const result = await new RunOrchestration(runner, profiles).execute({
		mode,
		request: "开发一个挥动左手的功能",
		workspaceRoot: "/tmp/rdk",
		skillDirectory: "/tmp/skills",
		humanInLoop: noHuman,
		onEvent: () => undefined,
	});

	assert.equal(result.succeeded, true);
	assert.deepEqual(calls, ["test", "coding", "verification", "deployment", "application"]);
	assert.deepEqual(expectations, ["test", "coding", "verification", "deployment", "application"]);
	assert.deepEqual(result.stages.map((stage) => stage.id), ["python", "deployment", "application"]);
});

test("needs-human pauses an agent and retries it with the human response in delivery context", async () => {
	let calls = 0;
	const seenHumanDelivery: boolean[] = [];
	const runner: AgentRunner = {
		async run(request) {
			calls++;
			seenHumanDelivery.push(request.previousDeliveries.some((delivery) => delivery.stageId === "human"));
			if (calls === 1) return { summary: "missing protocol", outcome: "needs-human", question: "协议版本是什么？" };
			return { summary: "application tested", outcome: "completed" };
		},
	};
	const human: HumanInLoop = {
		async requestInput(request) {
			assert.equal(request.question, "协议版本是什么？");
			return { action: "continue", message: "使用 v2" };
		},
	};
	const result = await new RunOrchestration(runner, profiles).execute({
		mode: applicationMode,
		request: "组合测试站立和摇头 Skill",
		workspaceRoot: "/tmp/rdk",
		skillDirectory: "/tmp/skills",
		humanInLoop: human,
		onEvent: () => undefined,
	});

	assert.equal(result.succeeded, true);
	assert.deepEqual(seenHumanDelivery, [false, true]);
});

test("human can abort a blocked workflow", async () => {
	const runner: AgentRunner = {
		async run() {
			return { summary: "blocked", outcome: "needs-human", question: "需要设备吗？" };
		},
	};
	const human: HumanInLoop = {
		async requestInput() {
			return { action: "abort", message: "/abort" };
		},
	};
	const result = await new RunOrchestration(runner, profiles).execute({
		mode: applicationMode,
		request: "测试效果",
		workspaceRoot: "/tmp/rdk",
		skillDirectory: "/tmp/skills",
		humanInLoop: human,
		onEvent: () => undefined,
	});
	assert.equal(result.succeeded, false);
	assert.match(result.stages[0]?.detail ?? "", /人类终止/);
});

test("application forwards loaded and selected Skill events to the UI", async () => {
	const runner: AgentRunner = {
		async run(request) {
			const skill = { name: "servo-control", description: "servo", filePath: "/skills/servo-control/SKILL.md" };
			request.onEvent({ type: "skills-loaded", skills: [skill] });
			request.onEvent({ type: "skill-selected", skill });
			return { summary: "application tested", outcome: "completed" };
		},
	};
	const events: WorkflowEvent[] = [];
	await new RunOrchestration(runner, profiles).execute({
		mode: applicationMode,
		request: "摇一下耳朵",
		workspaceRoot: "/tmp/rdk",
		skillDirectory: "/tmp/skills",
		humanInLoop: noHuman,
		onEvent: (event) => events.push(event),
	});

	assert.deepEqual(events.find((event) => event.type === "skills-loaded"), {
		type: "skills-loaded",
		stageId: "application",
		skills: [{ name: "servo-control", description: "servo", filePath: "/skills/servo-control/SKILL.md" }],
	});
	assert.equal(events.find((event) => event.type === "skill-selected")?.type, "skill-selected");
});

test("TDD tool log keeps the raw tool identity while showing board execution and valid-red guidance", async () => {
	const runner: AgentRunner = {
		async run(request) {
			if (request.expectation === "test") {
				request.onEvent({
					type: "tool-start",
					toolName: "bash",
					displayName: "bash（板端 x5-root / bwrap）",
					summary: "cd /workspace && python3 -m unittest",
				});
				request.onEvent({
					type: "tool-end",
					toolName: "bash",
					displayName: "bash（板端 x5-root / bwrap）",
					result: `[rdk-agent 沙箱] backend=ssh-bwrap target=x5-root cwd=/workspace uid=65534 network=none hardware=none\n${"x".repeat(2_100)}\nAttributeError: wave_right_hand`,
					isError: true,
				});
			}
			return { summary: "done", outcome: "completed" };
		},
	};
	const events: WorkflowEvent[] = [];
	const result = await new RunOrchestration(runner, profiles).execute({
		mode: developmentMode,
		request: "开发一个挥动右手的功能",
		workspaceRoot: "/tmp/rdk",
		skillDirectory: "/tmp/skills",
		humanInLoop: noHuman,
		onEvent: (event) => events.push(event),
	});
	const log = events
		.filter((event): event is Extract<WorkflowEvent, { type: "agent-event" }> => event.type === "agent-event")
		.map((event) => event.text)
		.join("");
	assert.equal(result.succeeded, true);
	assert.match(log, /\[工具\] bash（板端 x5-root \/ bwrap）：cd \/workspace/);
	assert.match(log, /退出码非 0，等待测试 Agent 判定是否为有效红测/);
	assert.match(log, /\[rdk-agent 沙箱\].*uid=65534/);
	assert.match(log, /AttributeError: wave_right_hand/);
});
