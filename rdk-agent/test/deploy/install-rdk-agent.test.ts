import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryDirectory = resolve(projectDirectory, "..");

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

test("installer removes retired servo Python validation without overwriting customized configuration", (context) => {
	const temporaryDirectory = mkdtempSync(join(tmpdir(), "rdk-agent-installer-migration-"));
	context.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

	const installDirectory = join(temporaryDirectory, "app");
	const binaryDirectory = join(temporaryDirectory, "bin");
	const configDirectory = join(temporaryDirectory, "config");
	const fakeBinaryDirectory = join(temporaryDirectory, "fake-bin");
	mkdirSync(join(installDirectory, "config"), { recursive: true });
	mkdirSync(configDirectory, { recursive: true });
	mkdirSync(fakeBinaryDirectory, { recursive: true });

	writeFileSync(join(installDirectory, "config", "agents.yaml"), "previous-default\n");
	const customizedConfiguration = `version: 2
agents:
  - id: python-test
    validation:
      kind: servo-python-test
    systemPrompt: Customized prompt
`;
	writeFileSync(join(configDirectory, "agents.yaml"), customizedConfiguration);

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
	assert.match(result.stdout, /已迁移旧版 servo-python-test 配置/);
	const migratedConfiguration = readFileSync(join(configDirectory, "agents.yaml"), "utf8");
	assert.doesNotMatch(migratedConfiguration, /servo-python-test/);
	assert.match(migratedConfiguration, /systemPrompt: Customized prompt/);
	assert.equal(
		readFileSync(join(configDirectory, "agents.yaml.before-servo-python-test-migration"), "utf8"),
		customizedConfiguration,
	);
});

test("stack installer covers board and development-machine deployment", () => {
	const stackInstaller = join(projectDirectory, "deploy", "install-rdk-agent-stack.sh");
	const boardInstaller = join(repositoryDirectory, "rdk-sophon", "deploy", "scripts", "deploy-to-board.sh");
	const stackHelp = spawnSync("bash", [stackInstaller, "--help"], { encoding: "utf8" });
	const boardHelp = spawnSync("bash", [boardInstaller, "--help"], { encoding: "utf8" });

	assert.equal(stackHelp.status, 0, stackHelp.stderr);
	assert.match(stackHelp.stdout, /--board-address/);
	assert.match(stackHelp.stdout, /--board-only/);
	assert.match(stackHelp.stdout, /--development-only/);
	assert.match(stackHelp.stdout, /--preflight-only/);
	assert.match(stackHelp.stdout, /--skip-servo-bootstrap/);
	assert.equal(boardHelp.status, 0, boardHelp.stderr);
	assert.match(boardHelp.stdout, /--enable-plugins/);

	const source = readFileSync(stackInstaller, "utf8");
	assert.match(source, /deploy-to-board\.sh.*--enable-plugins/s);
	assert.match(source, /install-sophonctl\.sh/);
	assert.match(source, /podman pull docker\.io\/library\/python:3\.12-slim/);
	assert.match(source, /install-rdk-agent\.sh/);
	assert.match(source, /sophonctl --board x5 plugins list/);
	assert.doesNotMatch(source, /servo_actions\/actions\.json/);
	assert.match(source, /systemctl restart probe-daemon\.service/);
	assert.match(source, /\[rdk-sophon\] 部署服务端/);
	assert.match(source, /\[rdk-agent\] 安装 MagicBox servo 运行文件/);
	assert.match(source, /\[rdk-sophon\] 安装 sophonctl/);
	assert.match(source, /\[rdk-agent\] 安装 TUI 编排器/);
});

test("stack installer preflight handles variables next to Chinese punctuation", (context) => {
	const temporaryDirectory = mkdtempSync(join(tmpdir(), "rdk-agent-stack-preflight-"));
	context.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

	const fakeBinaryDirectory = join(temporaryDirectory, "bin");
	mkdirSync(fakeBinaryDirectory, { recursive: true });
	for (const commandName of ["ssh", "scp", "cargo"]) {
		const commandPath = join(fakeBinaryDirectory, commandName);
		writeFileSync(commandPath, commandName === "ssh" ? "#!/bin/sh\necho aarch64\n" : "#!/bin/sh\nexit 0\n");
		chmodSync(commandPath, 0o755);
	}

	const stackInstaller = join(projectDirectory, "deploy", "install-rdk-agent-stack.sh");
	const result = spawnSync(
		"bash",
		[
			stackInstaller,
			"--ssh-host",
			"x5-root",
			"--board-address",
			"192.168.128.10:7777",
			"--skip-podman",
			"--preflight-only",
		],
		{
			encoding: "utf8",
			env: { ...process.env, PATH: `${fakeBinaryDirectory}:${process.env.PATH ?? ""}` },
		},
	);

	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /SSH 可用：x5-root；sophonctl 地址：192\.168\.128\.10:7777/);
	assert.match(result.stdout, /预检完成（目标：all），未执行任何安装或部署/);
});

test("development-only preflight does not require board SSH", (context) => {
	const temporaryDirectory = mkdtempSync(join(tmpdir(), "rdk-agent-development-preflight-"));
	context.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

	const fakeBinaryDirectory = join(temporaryDirectory, "bin");
	mkdirSync(fakeBinaryDirectory, { recursive: true });
	const fakeSsh = join(fakeBinaryDirectory, "ssh");
	writeFileSync(fakeSsh, "#!/bin/sh\necho 'development-only must not use ssh' >&2\nexit 86\n");
	chmodSync(fakeSsh, 0o755);
	const fakeCargo = join(fakeBinaryDirectory, "cargo");
	writeFileSync(fakeCargo, "#!/bin/sh\nexit 0\n");
	chmodSync(fakeCargo, 0o755);

	const stackInstaller = join(projectDirectory, "deploy", "install-rdk-agent-stack.sh");
	const result = spawnSync(
		"bash",
		[
			stackInstaller,
			"--development-only",
			"--board-address",
			"192.168.128.10:7777",
			"--skip-podman",
			"--preflight-only",
		],
		{
			encoding: "utf8",
			env: { ...process.env, PATH: `${fakeBinaryDirectory}:${process.env.PATH ?? ""}` },
		},
	);

	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.doesNotMatch(result.stderr, /development-only must not use ssh/);
	assert.match(result.stdout, /开发机预检通过/);
	assert.match(result.stdout, /预检完成（目标：development）/);
});

test("stack installer rejects conflicting deployment targets", () => {
	const stackInstaller = join(projectDirectory, "deploy", "install-rdk-agent-stack.sh");
	const result = spawnSync("bash", [stackInstaller, "--board-only", "--development-only"], { encoding: "utf8" });

	assert.equal(result.status, 2);
	assert.match(result.stderr, /不能与.*同时使用/);
});
