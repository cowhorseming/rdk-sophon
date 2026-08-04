import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentProfile } from "../../src/domain/agent-profile.ts";
import {
	configuredSkillSelectionRetryPrompt,
	createAgentResourceLoader,
	enforceApplicationSkillSelection,
	exceedsToolCallLimit,
	toolCallSummary,
	toolExecutionName,
	needsConfiguredSkillSelectionRetry,
	selectedSkillFromRead,
} from "../../src/infra/pi-agent-runner.ts";
import type { AgentRunRequest } from "../../src/shared/agent-runner.ts";

const profile: AgentProfile = {
	id: "application",
	name: "Application",
	description: "test",
	tools: ["read"],
	skills: ["configured-skill"],
	systemPrompt: "test",
	writePaths: [],
	timeoutSeconds: 60,
	maxToolCalls: 5,
};

test("Pi resource loading uses the configured Skill list as a strict allowlist", async (context) => {
	const directory = mkdtempSync(join(tmpdir(), "rdk-agent-skills-"));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	const skillDirectory = join(directory, "skills", "configured-skill");
	mkdirSync(skillDirectory, { recursive: true });
	writeFileSync(
		join(skillDirectory, "SKILL.md"),
		"---\nname: configured-skill\ndescription: configured only\n---\n\n# Configured\n",
	);
	const request: AgentRunRequest = {
		profile,
		userRequest: "test",
		workspaceRoot: directory,
		skillDirectory: join(directory, "skills"),
		expectation: "application",
		previousDeliveries: [],
		onEvent: () => undefined,
	};
	const loader = createAgentResourceLoader(request);
	await loader.reload();
	const loaded = loader.getSkills().skills;

	assert.deepEqual(loaded.map((skill) => skill.name), ["configured-skill"]);
	assert.equal(loader.getSkills().diagnostics.length, 0);
	assert.equal(selectedSkillFromRead("read", { path: loaded[0]!.filePath }, directory, loaded)?.name, "configured-skill");
	assert.equal(selectedSkillFromRead("read", { path: "README.md" }, directory, loaded), undefined);
	assert.equal(selectedSkillFromRead("bash", { path: loaded[0]!.filePath }, directory, loaded), undefined);
});

test("application cannot report completion without reading a configured Skill", () => {
	const completed = { summary: "done", outcome: "completed" } as const;
	assert.equal(enforceApplicationSkillSelection(completed, "application", 1, 1), completed);
	assert.equal(enforceApplicationSkillSelection(completed, "coding", 1, 0), completed);
	assert.deepEqual(enforceApplicationSkillSelection(completed, "application", 1, 0), {
		summary: "done",
		outcome: "needs-human",
		question: "机器人应用 Agent 未读取任何白名单 Skill，无法证明本次需求经过 Skill 选择与约束。请补充需求后重试，或输入 /abort 终止。",
	});
});

test("any completed Skill-enabled stage gets one exact-path selection retry", () => {
	const completed = { summary: "done", outcome: "completed" as const };
	assert.equal(needsConfiguredSkillSelectionRetry(completed, 1, 0), true);
	assert.equal(needsConfiguredSkillSelectionRetry(completed, 1, 1), false);
	assert.equal(needsConfiguredSkillSelectionRetry({ summary: "retry", outcome: "revision" }, 1, 0), false);
	const prompt = configuredSkillSelectionRetryPrompt([
		{ name: "demo", filePath: "/config/skills/demo/SKILL.md" },
	]);
	assert.match(prompt, /\/config\/skills\/demo\/SKILL\.md/);
	assert.match(prompt, /不得在业务工作区猜路径/);
});

test("omitting maxToolCalls keeps tool calls unlimited", () => {
	assert.equal(exceedsToolCallLimit(10_000, undefined), false);
	assert.equal(exceedsToolCallLimit(10, 10), false);
	assert.equal(exceedsToolCallLimit(11, 10), true);
});

test("tool log presents the effective board backend and rewritten sandbox path", () => {
	const boardProfile: AgentProfile = {
		...profile,
		tools: ["read", "bash", "write"],
		sandbox: {
			kind: "ssh-bwrap",
			host: "x5-root",
			remoteRoot: "/userdata/rdk-agent/runs",
			network: "none",
			hardwareAccess: false,
			commandTimeoutSeconds: 30,
		},
	};
	assert.equal(toolExecutionName("read", boardProfile), "read（开发机工作区）");
	assert.equal(toolExecutionName("bash", boardProfile), "bash（板端 x5-root / bwrap）");
	assert.equal(
		toolCallSummary(
			"bash",
			{ command: "cd /tmp/workspace/examples && python3 -m unittest" },
			"/tmp/workspace",
			boardProfile,
		),
		"cd /workspace/examples && python3 -m unittest",
	);
});
