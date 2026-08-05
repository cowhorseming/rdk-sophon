import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { isReadOnlyApplicationRequest } from "../domain/application-intent.ts";
import type { AgentProfile } from "../domain/agent-profile.ts";
import type { AgentExpectation } from "../shared/agent-runner.ts";
import { createDeploymentToolDefinition } from "./deployment-agent-tool.ts";
import { createActionPackageToolDefinition } from "./action-package-tool.ts";
import { createPodmanSandboxOperations } from "./podman-sandbox.ts";

type AnyToolDefinition = ToolDefinition<any, any, any>;

/** Enforces the configured mutation boundary below the prompt layer. */
export class WorkspaceWritePolicy {
	private readonly root: string;
	private readonly patterns: readonly RegExp[];
	private readonly deniedPatterns: readonly RegExp[];
	private readonly directoryPrefixes: readonly string[];

	constructor(workspaceRoot: string, writePaths: readonly string[]) {
		this.root = resolve(workspaceRoot);
		this.patterns = writePaths.filter((pattern) => !pattern.startsWith("!")).map((pattern) => this.glob(pattern));
		this.deniedPatterns = writePaths.filter((pattern) => pattern.startsWith("!")).map((pattern) => this.glob(pattern.slice(1)));
		this.directoryPrefixes = writePaths.filter((pattern) => !pattern.startsWith("!")).map((pattern) => {
			const wildcard = pattern.search(/[?*]/);
			const staticPart = wildcard < 0 ? pattern : pattern.slice(0, wildcard);
			return staticPart.slice(0, staticPart.lastIndexOf("/")).replace(/^\.\//, "");
		});
	}

	assertFileAllowed(path: string): void {
		const workspacePath = this.workspacePath(path);
		if (!this.patterns.some((pattern) => pattern.test(workspacePath)) || this.deniedPatterns.some((pattern) => pattern.test(workspacePath))) {
			throw new Error(`写入被拒绝：${workspacePath} 不在 Agent 的 writePaths 白名单中`);
		}
	}

	assertDirectoryAllowed(path: string): void {
		const workspacePath = this.workspacePath(path).replace(/\/$/, "");
		if (!this.directoryPrefixes.some((prefix) => workspacePath.startsWith(prefix) || prefix.startsWith(workspacePath))) {
			throw new Error(`创建目录被拒绝：${workspacePath} 不在 Agent 的 writePaths 范围中`);
		}
	}

	private workspacePath(path: string): string {
		const absolute = resolve(this.root, path);
		const workspacePath = relative(this.root, absolute);
		if (workspacePath === ".." || workspacePath.startsWith(`..${sep}`) || workspacePath === "") {
			throw new Error(`写入被拒绝：${absolute} 不在工作目录内`);
		}
		return workspacePath.split(sep).join("/");
	}

	private glob(pattern: string): RegExp {
		const normalized = pattern.replace(/^\.\//, "").replaceAll("\\", "/");
		let encoded = "";
		for (let index = 0; index < normalized.length; index++) {
			const character = normalized[index]!;
			if (character === "*" && normalized[index + 1] === "*") {
				encoded += ".*";
				index++;
			} else if (character === "*") encoded += "[^/]*";
			else if (character === "?") encoded += "[^/]";
			else encoded += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
		}
		return new RegExp(`^${encoded}$`);
	}
}

const forbiddenShell = [
	/[<>`]/,
	/\$\(/,
	/\b(rm|mv|cp|install|mkdir|touch|chmod|chown|ln|tee|truncate)\b/,
	/\bsed\s+[^\n]*-[^\n]*i\b/,
	/\b(perl|python\d*)\s+[^\n]*\s-i\b/,
	/\bgit\s+(add|apply|checkout|clean|commit|merge|rebase|reset|restore|switch)\b/,
	/\b(npm|pnpm|yarn|pip\d*|cargo)\s+(install|add|remove|update|fmt)\b/,
];

export function assertReadOnlyShell(command: string): void {
	const violation = forbiddenShell.find((pattern) => pattern.test(command));
	if (violation) throw new Error(`bash 仅允许测试与只读检查，命令被策略拒绝：${command}`);
}

const sophonctl = String.raw`(?:[^\s;&|]*/)?sophonctl`;
const boardOption = String.raw`(?:\s+--board\s+[^\s;&|]+)?`;
const readOnlySophonctlCommands = [
	new RegExp(`^${sophonctl}\\s+(?:--help|--version)$`),
	new RegExp(`^${sophonctl}${boardOption}\\s+plugins\\s+list$`),
	new RegExp(`^${sophonctl}${boardOption}\\s+[a-z][a-z0-9-]*\\s+--help$`),
	/^(?:command\s+-v|which)\s+sophonctl$/,
];

export function assertApplicationShellAllowed(command: string, expectation: AgentExpectation, userRequest: string): void {
	if (expectation !== "application" || !isReadOnlyApplicationRequest(userRequest)) return;
	const normalized = command.trim().replace(/\s+/g, " ");
	if (readOnlySophonctlCommands.some((pattern) => pattern.test(normalized))) return;
	throw new Error(`应用模式当前输入是只读查询，Bash 只允许 sophonctl 列表、帮助和版本检查，命令被拒绝：${normalized}`);
}

export function scopedAgentTools(
	workspaceRoot: string,
	skillDirectory: string,
	profile: AgentProfile,
	runContext?: { expectation: AgentExpectation; userRequest: string },
): AnyToolDefinition[] {
	const policy = new WorkspaceWritePolicy(workspaceRoot, profile.writePaths);
	const definitions: Record<string, AnyToolDefinition | undefined> = {
		read: createReadToolDefinition(workspaceRoot),
		bash: createBashToolDefinition(workspaceRoot, {
			operations: profile.sandbox?.kind === "podman"
				? createPodmanSandboxOperations(workspaceRoot, profile.sandbox)
				: undefined,
			spawnHook: (spawnContext) => {
				assertReadOnlyShell(spawnContext.command);
				if (runContext) {
					assertApplicationShellAllowed(spawnContext.command, runContext.expectation, runContext.userRequest);
				}
				return { ...spawnContext, env: { ...spawnContext.env, PYTHONDONTWRITEBYTECODE: "1" } };
			},
		}),
		edit: createEditToolDefinition(workspaceRoot, {
			operations: {
				readFile,
				access: async (path) => {
					policy.assertFileAllowed(path);
					await access(path);
				},
				writeFile: async (path, content) => {
					policy.assertFileAllowed(path);
					await writeFile(path, content);
				},
			},
		}),
		write: createWriteToolDefinition(workspaceRoot, {
			operations: {
				mkdir: async (path) => {
					policy.assertDirectoryAllowed(path);
					await mkdir(path, { recursive: true });
				},
				writeFile: async (path, content) => {
					policy.assertFileAllowed(path);
					await writeFile(path, content);
				},
			},
		}),
		deploy: profile.deployment ? createDeploymentToolDefinition(workspaceRoot, skillDirectory, profile) : undefined,
		"action-package": profile.actionPackage ? createActionPackageToolDefinition(workspaceRoot, profile) : undefined,
	};
	return profile.tools.map((name) => {
		const definition = definitions[name];
		if (!definition) throw new Error(`不支持的 Agent 工具：${name}`);
		return definition;
	});
}
