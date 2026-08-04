import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { ManagedWorkspaceResolver } from "../../src/infra/managed-workspace.ts";
import type { ManagedTemplateWorkspaceConfiguration } from "../../src/shared/agent-configuration.ts";

function fixture(context: { after(callback: () => void): void }) {
	const root = mkdtempSync(join(tmpdir(), "rdk-agent-managed-workspace-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const template = join(root, "template");
	mkdirSync(join(template, "examples"), { recursive: true });
	writeFileSync(join(template, "examples", "servo.py"), "baseline\n");
	const configuration: ManagedTemplateWorkspaceConfiguration = {
		kind: "managed-template",
		id: "magicbox",
		version: 3,
		templateDirectory: template,
		requiredPaths: ["examples/servo.py"],
	};
	return { root, template, configuration };
}

test("no-argument developer mode provisions and reuses a versioned managed workspace", (context) => {
	const { root, configuration } = fixture(context);
	const resolver = new ManagedWorkspaceResolver(join(root, "state"));
	const first = resolver.resolve(configuration);
	assert.equal(first.kind, "managed");
	assert.equal(first.created, true);
	assert.match(first.root, /workspaces\/magicbox\/v3$/);
	assert.equal(readFileSync(join(first.root, "examples", "servo.py"), "utf8"), "baseline\n");
	assert.equal(existsSync(join(first.root, ".rdk-agent-workspace.json")), true);

	writeFileSync(join(first.root, "examples", "servo.py"), "developer change\n");
	const second = resolver.resolve(configuration);
	assert.equal(second.created, false);
	assert.equal(second.root, first.root);
	assert.equal(readFileSync(join(second.root, "examples", "servo.py"), "utf8"), "developer change\n");
});

test("an explicit workspace keeps repository-contributor mode without provisioning", (context) => {
	const { root, configuration } = fixture(context);
	const external = join(root, "external-project");
	mkdirSync(external);
	const resolved = new ManagedWorkspaceResolver(join(root, "state")).resolve(configuration, external);
	assert.deepEqual(resolved, {
		root: resolve(external),
		kind: "external",
		description: `外部源码工作区 ${resolve(external)}`,
		created: false,
	});
	assert.equal(existsSync(join(root, "state")), false);
	assert.throws(
		() => new ManagedWorkspaceResolver(join(root, "state")).resolve(configuration, join(root, "missing")),
		/外部源码工作区不存在/,
	);
});
