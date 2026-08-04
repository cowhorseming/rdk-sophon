import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentProfile } from "../../src/domain/agent-profile.ts";
import { createDeploymentToolDefinition, validateSkillPackage } from "../../src/infra/deployment-agent-tool.ts";

test("skill package validation requires loadable Pi metadata", () => {
	assert.doesNotThrow(() => validateSkillPackage("---\nname: servo-control\ndescription: test\n---\n# Body\n", "servo-control"));
	assert.throws(() => validateSkillPackage("# Body\n", "servo-control"), /frontmatter/);
	assert.throws(
		() => validateSkillPackage("---\nname: other\ndescription: test\n---\n# Body\n", "servo-control"),
		/name 必须是 servo-control/,
	);
});

test("skill deployment installs a verified workspace delivery outside the source tree", async (context) => {
	const workspace = mkdtempSync(join(tmpdir(), "rdk-agent-workspace-"));
	const config = mkdtempSync(join(tmpdir(), "rdk-agent-config-"));
	context.after(() => {
		rmSync(workspace, { recursive: true, force: true });
		rmSync(config, { recursive: true, force: true });
	});
	const source = join(workspace, ".rdk-agent", "deliveries", "skills", "servo-control");
	mkdirSync(source, { recursive: true });
	writeFileSync(join(source, "SKILL.md"), "---\nname: servo-control\ndescription: test\n---\nnew skill\n");
	writeFileSync(join(source, "acceptance.md"), "acceptance\n");
	const skillDirectory = join(config, "skills");
	mkdirSync(join(skillDirectory, "servo-control"), { recursive: true });
	writeFileSync(join(skillDirectory, "servo-control", "SKILL.md"), "old skill\n");
	writeFileSync(join(skillDirectory, "servo-control", "acceptance.md"), "installed acceptance\n");
	const profile: AgentProfile = {
		id: "skill-deploy",
		name: "Skill deploy",
		description: "deploy",
		tools: ["deploy"],
		skills: [],
		systemPrompt: "deploy",
		writePaths: [],
		timeoutSeconds: 60,
		deployment: {
			kind: "skill",
			source: ".rdk-agent/deliveries/skills/servo-control",
			skillName: "servo-control",
			runtimeFiles: ["SKILL.md"],
		},
	};
	const tool = createDeploymentToolDefinition(workspace, skillDirectory, profile);
	const result = await tool.execute("call", {}, undefined, undefined, {} as never);

	assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /部署成功/);
	assert.match(readFileSync(join(skillDirectory, "servo-control", "SKILL.md"), "utf8"), /new skill/);
	assert.equal(readFileSync(join(skillDirectory, "servo-control", "acceptance.md"), "utf8"), "installed acceptance\n");
	assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /runtimeFiles=SKILL\.md/);
});

test("invalid skill delivery is rejected before replacing the installed Skill", async (context) => {
	const workspace = mkdtempSync(join(tmpdir(), "rdk-agent-invalid-skill-"));
	const config = mkdtempSync(join(tmpdir(), "rdk-agent-invalid-config-"));
	context.after(() => {
		rmSync(workspace, { recursive: true, force: true });
		rmSync(config, { recursive: true, force: true });
	});
	const source = join(workspace, ".rdk-agent", "deliveries", "skills", "servo-control");
	const installed = join(config, "skills", "servo-control");
	mkdirSync(source, { recursive: true });
	mkdirSync(installed, { recursive: true });
	writeFileSync(join(source, "SKILL.md"), "# missing metadata\n");
	writeFileSync(join(installed, "SKILL.md"), "installed\n");
	const invalidProfile: AgentProfile = {
		id: "skill-deploy",
		name: "Skill deploy",
		description: "deploy",
		tools: ["deploy"],
		skills: [],
		systemPrompt: "deploy",
		writePaths: [],
		timeoutSeconds: 60,
		deployment: { kind: "skill", source: ".rdk-agent/deliveries/skills/servo-control", skillName: "servo-control" },
	};
	const tool = createDeploymentToolDefinition(workspace, join(config, "skills"), invalidProfile);
	await assert.rejects(() => tool.execute("call", {}, undefined, undefined, {} as never), /frontmatter/);
	assert.equal(readFileSync(join(installed, "SKILL.md"), "utf8"), "installed\n");
});
