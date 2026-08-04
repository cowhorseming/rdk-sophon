import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { YamlAgentConfigurationLoader } from "../../src/infra/yaml-agent-configuration-loader.ts";

test("loads ordered agent profiles, prompts, tools and skills from YAML", (context) => {
	const directory = mkdtempSync(join(tmpdir(), "rdk-agent-config-"));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	mkdirSync(join(directory, "skills", "test-skill"), { recursive: true });
	writeFileSync(join(directory, "skills", "test-skill", "SKILL.md"), "---\nname: test-skill\ndescription: test\n---\n");
	writeFileSync(
		join(directory, "agents.yaml"),
		`version: 2
defaultMode: development
workspace:
  requiredPaths: [examples/plugin.toml]
agents:
  - id: author
    name: Author
    description: Writes code
    tools: [read, write]
    writePaths: [tests/*.ts]
    skills: [test-skill]
    timeoutSeconds: 45
    maxToolCalls: 7
    sandbox:
      kind: podman
      image: docker.io/library/python:3.12-slim
      network: none
    systemPrompt: |
      Follow the project conventions.
modes:
  - id: development
    name: Development
    type: robot-development
    loops:
      - id: python
        name: Python
        deliverable: script
        testAgent: author
        codingAgent: author
        verificationAgent: author
        maxIterations: 2
`,
	);

	const configuration = new YamlAgentConfigurationLoader().load(directory);
	assert.equal(configuration.profiles[0]?.id, "author");
	assert.deepEqual(configuration.profiles[0]?.tools, ["read", "write"]);
	assert.deepEqual(configuration.profiles[0]?.skills, ["test-skill"]);
	assert.deepEqual(configuration.profiles[0]?.writePaths, ["tests/*.ts"]);
	assert.equal(configuration.profiles[0]?.systemPrompt, "Follow the project conventions.");
	assert.equal(configuration.profiles[0]?.timeoutSeconds, 45);
	assert.equal(configuration.profiles[0]?.maxToolCalls, 7);
	assert.deepEqual(configuration.profiles[0]?.sandbox, {
		kind: "podman",
		image: "docker.io/library/python:3.12-slim",
		network: "none",
	});
	assert.deepEqual(configuration.workspace, { kind: "current-directory", requiredPaths: ["examples/plugin.toml"] });
	assert.equal(configuration.defaultModeId, "development");
	assert.equal(configuration.modes[0]?.type, "robot-development");
	if (configuration.modes[0]?.type === "robot-development") {
		assert.deepEqual(configuration.modes[0].acceptanceAgentIds, []);
	}
});

test("rejects a configured skill that does not exist", (context) => {
	const directory = mkdtempSync(join(tmpdir(), "rdk-agent-config-"));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	writeFileSync(
		join(directory, "agents.yaml"),
		"version: 2\ndefaultMode: application\nagents:\n  - id: author\n    name: Author\n    description: Test\n    tools: []\n    skills: [missing]\n    systemPrompt: Test\nmodes:\n  - id: application\n    name: Application\n    type: robot-application\n    agent: author\n",
	);
	assert.throws(() => new YamlAgentConfigurationLoader().load(directory), /Skill 不存在/);
});

test("rejects write-capable agents without a path allowlist", (context) => {
	const directory = mkdtempSync(join(tmpdir(), "rdk-agent-config-"));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	writeFileSync(
		join(directory, "agents.yaml"),
		"version: 2\ndefaultMode: application\nagents:\n  - id: author\n    name: Author\n    description: Test\n    tools: [write]\n    skills: []\n    systemPrompt: Test\nmodes:\n  - id: application\n    name: Application\n    type: robot-application\n    agent: author\n",
	);
	assert.throws(() => new YamlAgentConfigurationLoader().load(directory), /writePaths/);
});

test("rejects a development sandbox with host networking", (context) => {
	const directory = mkdtempSync(join(tmpdir(), "rdk-agent-config-"));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	writeFileSync(
		join(directory, "agents.yaml"),
		"version: 2\ndefaultMode: application\nagents:\n  - id: author\n    name: Author\n    description: Test\n    tools: [bash]\n    skills: []\n    sandbox:\n      kind: podman\n      image: python:3.12-slim\n      network: host\n    systemPrompt: Test\nmodes:\n  - id: application\n    name: Application\n    type: robot-application\n    agent: author\n",
	);
	assert.throws(() => new YamlAgentConfigurationLoader().load(directory), /network 当前必须为 none/);
});

test("loads a hardware-free SSH bwrap board sandbox", (context) => {
	const directory = mkdtempSync(join(tmpdir(), "rdk-agent-config-"));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	writeFileSync(
		join(directory, "agents.yaml"),
		"version: 2\ndefaultMode: application\nagents:\n  - id: author\n    name: Author\n    description: Test\n    tools: [bash]\n    skills: []\n    sandbox:\n      kind: ssh-bwrap\n      host: x5-root\n      remoteRoot: /userdata/rdk-agent/runs\n      network: none\n      hardwareAccess: false\n    systemPrompt: Test\nmodes:\n  - id: application\n    name: Application\n    type: robot-application\n    agent: author\n",
	);
	assert.deepEqual(new YamlAgentConfigurationLoader().load(directory).profiles[0]?.sandbox, {
		kind: "ssh-bwrap",
		host: "x5-root",
		remoteRoot: "/userdata/rdk-agent/runs",
		network: "none",
		hardwareAccess: false,
		commandTimeoutSeconds: 30,
	});
});

test("rejects SSH bwrap sandboxes that expose hardware", (context) => {
	const directory = mkdtempSync(join(tmpdir(), "rdk-agent-config-"));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	writeFileSync(
		join(directory, "agents.yaml"),
		"version: 2\ndefaultMode: application\nagents:\n  - id: author\n    name: Author\n    description: Test\n    tools: [bash]\n    skills: []\n    sandbox:\n      kind: ssh-bwrap\n      host: x5-root\n      remoteRoot: /userdata/rdk-agent/runs\n      network: none\n      hardwareAccess: true\n    systemPrompt: Test\nmodes:\n  - id: application\n    name: Application\n    type: robot-application\n    agent: author\n",
	);
	assert.throws(() => new YamlAgentConfigurationLoader().load(directory), /hardwareAccess 当前必须显式为 false/);
});

test("bundled robot application mode loads the servo control skill", () => {
	const configuration = new YamlAgentConfigurationLoader().load(join(import.meta.dirname, "../../config"));
	const application = configuration.profiles.find((profile) => profile.id === "robot-application");
	assert.equal(configuration.defaultModeId, "robot-application");
	assert.deepEqual(application?.skills, ["servo-control"]);
	assert.match(application?.systemPrompt ?? "", /动作式需求即已授权执行该动作一次/);
	assert.match(application?.systemPrompt ?? "", /不得只做帮助检查就返回 completed/);
	assert.equal(configuration.modes.find((mode) => mode.id === "robot-application")?.type, "robot-application");
});

test("bundled development agents have unlimited tool calls and role-specific write permissions", () => {
	const configuration = new YamlAgentConfigurationLoader().load(join(import.meta.dirname, "../../config"));
	const byId = new Map(configuration.profiles.map((profile) => [profile.id, profile]));
	assert.equal(configuration.workspace.kind, "managed-template");
	assert.deepEqual(configuration.workspace.requiredPaths, [
		"examples/plugins/servo/servo_ctrl.py",
		"examples/plugins/servo/plugin.toml",
		"examples/plugins/servo/tests/test_wave_hands.py",
	]);
	if (configuration.workspace.kind === "managed-template") {
		assert.equal(configuration.workspace.id, "magicbox-servo");
		assert.equal(configuration.workspace.version, 2);
		assert.match(configuration.workspace.templateDirectory, /config\/templates\/magicbox-servo$/);
	}
	for (const profile of configuration.profiles) assert.equal(profile.maxToolCalls, undefined);
	for (const id of ["python-test", "python-coding", "cli-test", "cli-coding", "skill-test", "skill-coding"]) {
		const profile = byId.get(id);
		assert.ok(profile, `${id} should exist`);
		assert.equal(profile.maxToolCalls, undefined);
		assert.ok(profile.timeoutSeconds <= 300);
		assert.ok(profile.tools.includes("write"));
	}
	for (const id of ["python-verification", "cli-verification", "skill-verification"]) {
		const profile = byId.get(id);
		assert.ok(profile, `${id} should exist`);
		assert.equal(profile.tools.includes("write"), false);
		assert.equal(profile.tools.includes("edit"), false);
	}
	for (const id of ["python-test", "python-coding", "python-verification", "cli-test", "cli-coding", "cli-verification", "skill-verification"]) {
		assert.deepEqual(byId.get(id)?.sandbox, {
			kind: "ssh-bwrap",
			host: "x5-root",
			remoteRoot: "/userdata/rdk-agent/runs",
			network: "none",
			hardwareAccess: false,
			commandTimeoutSeconds: 30,
		});
	}
	for (const id of ["python-deploy", "cli-deploy", "skill-deploy", "cli-live-acceptance", "skill-live-acceptance", "robot-application"]) {
		assert.equal(byId.get(id)?.sandbox, undefined);
	}
	assert.match(byId.get("cli-test")?.systemPrompt ?? "", /test_cli_contract\.py/);
	assert.match(byId.get("python-test")?.systemPrompt ?? "", /禁止自创 `ServoController\.SINGLE_SIDE_ACTIONS`/);
	assert.match(byId.get("python-test")?.systemPrompt ?? "", /不安装 pytest/);
	assert.match(byId.get("python-test")?.systemPrompt ?? "", /sys\.modules\["Hobot\.GPIO"\]/);
	assert.match(byId.get("python-test")?.systemPrompt ?? "", /立即以 completed 交付/);
	assert.match(byId.get("python-test")?.systemPrompt ?? "", /进入 Python Coding Agent/);
	assert.match(byId.get("python-test")?.systemPrompt ?? "", /右手需求绝不能创建、修改、运行或交付左手测试/);
	assert.match(byId.get("python-test")?.systemPrompt ?? "", /call\.hold\(WAVE_POSITION_HOLD_SECONDS\)/);
	assert.match(byId.get("python-coding")?.systemPrompt ?? "", /50ms.*不足以作为肉眼可见/);
	assert.deepEqual(byId.get("python-test")?.validation, { kind: "servo-python-test" });
	assert.match(byId.get("cli-test")?.systemPrompt ?? "", /import tomli as tomllib/);
	assert.match(byId.get("cli-test")?.systemPrompt ?? "", /绝不能 patch sleep 后直接调用带该参数的 main/);
	assert.match(byId.get("skill-test")?.systemPrompt ?? "", /右手需求写成左手验收/);
	assert.match(byId.get("skill-live-acceptance")?.systemPrompt ?? "", /本次用户原始自然语言/);
	assert.match(byId.get("python-coding")?.systemPrompt ?? "", /禁止对同一个失败重复 edit\/bash 直至超时/);
	assert.match(byId.get("skill-coding")?.systemPrompt ?? "", /同一处第二次 edit 仍失败时禁止继续 edit/);
	assert.match(byId.get("skill-coding")?.systemPrompt ?? "", /已有交付 Skill 已包含本次动作及准确映射时允许零修改完成/);
	assert.match(byId.get("cli-verification")?.systemPrompt ?? "", /开发工作区没有安装到 sophonctl 注册表是正常状态/);
	assert.match(byId.get("skill-verification")?.systemPrompt ?? "", /静态合同满足时必须返回 passed/);
	assert.deepEqual(byId.get("skill-verification")?.validation, {
		kind: "skill-contract",
		source: ".rdk-agent/deliveries/skills/servo-control",
		skillName: "servo-control",
		manifest: "examples/plugins/servo/plugin.toml",
		entrypointSource: "examples/plugins/servo/servo_ctrl.py",
		evidenceFiles: [
			"examples/plugins/servo/tests/test_wave_*_hand.py",
			"examples/plugins/servo/tests/test_cli_contract.py",
		],
		baselineSkillName: "servo-control",
	});
	for (const id of ["python-deploy", "cli-deploy", "skill-deploy"]) {
		const profile = byId.get(id);
		assert.ok(profile?.tools.includes("deploy"), `${id} should expose deploy`);
		assert.ok(profile?.deployment, `${id} should have a deterministic deployment plan`);
	}
	assert.deepEqual(byId.get("skill-deploy")?.deployment, {
		kind: "skill",
		source: ".rdk-agent/deliveries/skills/servo-control",
		skillName: "servo-control",
		runtimeFiles: ["SKILL.md"],
	});
	const development = configuration.modes.find((mode) => mode.id === "robot-development");
	assert.equal(development?.type, "robot-development");
	if (development?.type === "robot-development") {
		assert.deepEqual(development.loops.map((loop) => loop.deploymentAgentId), ["python-deploy", "cli-deploy", "skill-deploy"]);
		assert.deepEqual(development.acceptanceAgentIds, ["cli-live-acceptance", "skill-live-acceptance"]);
	}
});
