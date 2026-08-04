import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("installer upgrades an unchanged default config while ignoring its generated migration example", (context) => {
	const temporaryDirectory = mkdtempSync(join(tmpdir(), "rdk-agent-installer-"));
	context.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

	const installDirectory = join(temporaryDirectory, "app");
	const binaryDirectory = join(temporaryDirectory, "bin");
	const configDirectory = join(temporaryDirectory, "config");
	const fakeBinaryDirectory = join(temporaryDirectory, "fake-bin");
	mkdirSync(join(installDirectory, "config"), { recursive: true });
	mkdirSync(configDirectory, { recursive: true });
	mkdirSync(fakeBinaryDirectory, { recursive: true });

	writeFileSync(join(installDirectory, "config", "agents.yaml"), "old-default\n");
	writeFileSync(join(configDirectory, "agents.yaml"), "old-default\n");
	writeFileSync(join(configDirectory, "agents.yaml.v2.example"), "generated-example\n");

	const fakeNode = join(fakeBinaryDirectory, "node");
	const fakeNpm = join(fakeBinaryDirectory, "npm");
	writeFileSync(fakeNode, '#!/bin/sh\nif [ "${1:-}" = "--version" ]; then echo v22.23.2; fi\nexit 0\n');
	writeFileSync(fakeNpm, "#!/bin/sh\nexit 0\n");
	chmodSync(fakeNode, 0o755);
	chmodSync(fakeNpm, 0o755);

	const result = spawnSync(
		"bash",
		[
			join(projectDirectory, "deploy", "install-rdk-agent.sh"),
			"--install-dir",
			installDirectory,
			"--bin-dir",
			binaryDirectory,
			"--config-dir",
			configDirectory,
		],
		{
			encoding: "utf8",
			env: { ...process.env, PATH: `${fakeBinaryDirectory}:/usr/bin:/bin` },
		},
	);

	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /未修改的默认配置已升级到最新版本/);
	assert.equal(
		readFileSync(join(configDirectory, "agents.yaml"), "utf8"),
		readFileSync(join(projectDirectory, "config", "agents.yaml"), "utf8"),
	);
	assert.equal(
		readdirSync(join(installDirectory, "config", "skills")).some((name) => name.startsWith(".servo-control.rdk-agent-")),
		false,
	);
	assert.equal(
		readFileSync(join(installDirectory, "config", "templates", "magicbox-servo", "examples", "plugins", "servo", "plugin.toml"), "utf8"),
		readFileSync(join(projectDirectory, "config", "templates", "magicbox-servo", "examples", "plugins", "servo", "plugin.toml"), "utf8"),
	);
});
