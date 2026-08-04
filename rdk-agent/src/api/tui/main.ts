import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { YamlAgentConfigurationLoader } from "../../infra/yaml-agent-configuration-loader.ts";
import { ManagedWorkspaceResolver } from "../../infra/managed-workspace.ts";
import { runHeadless } from "../cli/headless-runner.ts";
import { OrchestrationApp } from "./orchestration-app.ts";

interface CliOptions {
	workspaceRoot?: string;
	configDirectory: string;
	modeId?: string;
	request?: string;
}

function parseArgs(args: readonly string[]): CliOptions {
	const sourceDirectory = dirname(fileURLToPath(import.meta.url));
	const bundledConfigDirectory = resolve(sourceDirectory, "../../../config");
	let configDirectory = process.env.RDK_AGENT_CONFIG_DIR ?? bundledConfigDirectory;
	let workspaceRoot: string | undefined;
	let workspaceProvided = false;
	let modeId: string | undefined;
	let request: string | undefined;

	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === "--config-dir") {
			const value = args[index + 1];
			if (!value) throw new Error("--config-dir 需要目录参数");
			configDirectory = value;
			index++;
		} else if (argument === "--workspace") {
			const value = args[index + 1];
			if (!value) throw new Error("--workspace 需要目录参数");
			if (workspaceProvided) throw new Error("只能指定一个 workspace");
			workspaceRoot = value;
			workspaceProvided = true;
			index++;
		} else if (argument === "--mode") {
			const value = args[index + 1];
			if (!value) throw new Error("--mode 需要模式 id");
			modeId = value;
			index++;
		} else if (argument === "--request") {
			const value = args[index + 1];
			if (!value) throw new Error("--request 需要自然语言需求");
			request = value;
			index++;
		} else if (argument === "-h" || argument === "--help") {
			console.log("用法: rdk-agent [--config-dir <dir>] [--workspace <dir>|workspace]");
			console.log('自动运行: rdk-agent --mode robot-development --request "开发一个挥动右手的功能"');
			console.log("不指定 workspace 时使用配置中的内置模板托管工作区。");
			process.exit(0);
		} else if (argument?.startsWith("-")) {
			throw new Error(`未知参数：${argument}`);
		} else if (workspaceProvided) {
			throw new Error("只能指定一个 workspace");
		} else if (argument) {
			workspaceRoot = argument;
			workspaceProvided = true;
		}
	}

	if (modeId !== undefined && request === undefined) throw new Error("--mode 必须与 --request 一起使用");
	return {
		workspaceRoot: workspaceRoot ? resolve(workspaceRoot) : undefined,
		configDirectory: resolve(configDirectory),
		modeId,
		request,
	};
}

try {
	const options = parseArgs(process.argv.slice(2));
	const configuration = new YamlAgentConfigurationLoader().load(options.configDirectory);
	const workspace = new ManagedWorkspaceResolver().resolve(configuration.workspace, options.workspaceRoot);
	if (options.request !== undefined) {
		const succeeded = await runHeadless(workspace, configuration, options.modeId ?? configuration.defaultModeId, options.request);
		if (!succeeded) process.exitCode = 1;
	} else {
		new OrchestrationApp(workspace, configuration).start();
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
