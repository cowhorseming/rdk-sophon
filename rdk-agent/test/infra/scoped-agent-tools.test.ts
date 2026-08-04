import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceWritePolicy, assertApplicationShellAllowed, assertReadOnlyShell } from "../../src/infra/scoped-agent-tools.ts";

test("workspace write policy only accepts files matching the agent allowlist", () => {
	const policy = new WorkspaceWritePolicy("/tmp/workspace", ["rdk-agent/config/skills/*/SKILL.md"]);
	assert.doesNotThrow(() => policy.assertFileAllowed("/tmp/workspace/rdk-agent/config/skills/servo/SKILL.md"));
	assert.throws(() => policy.assertFileAllowed("/tmp/workspace/rdk-agent/config/skills/servo/acceptance.md"), /写入被拒绝/);
	assert.throws(() => policy.assertFileAllowed("/tmp/outside/SKILL.md"), /不在工作目录内/);
});

test("CLI test allowlist cannot overwrite Python or Skill deliverables", () => {
	const policy = new WorkspaceWritePolicy("/tmp/workspace", ["rdk-sophon/examples/plugins/*/tests/test_cli*.py"]);
	assert.doesNotThrow(() => policy.assertFileAllowed("rdk-sophon/examples/plugins/servo/tests/test_cli_contract.py"));
	assert.throws(() => policy.assertFileAllowed("rdk-sophon/examples/plugins/servo/tests/test_wave_hands.py"), /写入被拒绝/);
	assert.throws(() => policy.assertFileAllowed("rdk-agent/config/skills/servo-control/SKILL.md"), /写入被拒绝/);
});

test("Python test allowlist excludes files owned by the CLI loop", () => {
	const policy = new WorkspaceWritePolicy("/tmp/workspace", [
		"rdk-sophon/examples/plugins/*/tests/test_*.py",
		"!rdk-sophon/examples/plugins/*/tests/test_cli*.py",
	]);
	assert.doesNotThrow(() => policy.assertFileAllowed("rdk-sophon/examples/plugins/servo/tests/test_wave_hands.py"));
	assert.throws(() => policy.assertFileAllowed("rdk-sophon/examples/plugins/servo/tests/test_cli_contract.py"), /写入被拒绝/);
});

test("agent bash policy allows tests but blocks shell file mutation", () => {
	assert.doesNotThrow(() => assertReadOnlyShell("python3 -m unittest discover -s tests"));
	assert.doesNotThrow(() => assertReadOnlyShell("rg wave-hands examples/plugins/servo | head"));
	assert.throws(() => assertReadOnlyShell("printf x > tests/result.txt"), /策略拒绝/);
	assert.throws(() => assertReadOnlyShell("sed -i '' s/a/b/ file"), /策略拒绝/);
	assert.throws(() => assertReadOnlyShell("git checkout -- file"), /策略拒绝/);
});

test("read-only application requests cannot invoke robot action commands", () => {
	const query = "当前加载了哪些 Skill？";
	assert.doesNotThrow(() => assertApplicationShellAllowed("sophonctl plugins list", "application", query));
	assert.doesNotThrow(() => assertApplicationShellAllowed("sophonctl --board x5 servo --help", "application", query));
	assert.throws(
		() => assertApplicationShellAllowed("sophonctl servo shake-ears", "application", query),
		/只读查询.*命令被拒绝/,
	);
	assert.throws(() => assertApplicationShellAllowed("ssh x5-root python3 servo.py", "application", query), /命令被拒绝/);
	assert.doesNotThrow(() => assertApplicationShellAllowed("sophonctl servo shake-ears", "application", "摇一下耳朵"));
	assert.doesNotThrow(() => assertApplicationShellAllowed("sophonctl servo shake-ears", "coding", query));
});
