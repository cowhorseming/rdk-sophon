import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ActionPackageOperation, AgentProfile } from "../domain/agent-profile.ts";

type AnyToolDefinition = ToolDefinition<any, any, any>;

const parameters = Type.Union([
	Type.Object({
		operation: Type.Literal("scaffold"),
		actionId: Type.String({ pattern: "^[a-z][a-z0-9-]*$" }),
		description: Type.String({ minLength: 1 }),
		start: Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("both"), Type.Literal("none")]),
		intentExamples: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	}),
	Type.Object({ operation: Type.Literal("validate"), actionId: Type.String({ pattern: "^[a-z][a-z0-9-]*$" }) }),
	Type.Object({ operation: Type.Literal("build") }),
]);

function run(command: string, args: readonly string[], cwd: string, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, signal, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => { stdout += chunk; });
		child.stderr.on("data", (chunk: string) => { stderr += chunk; });
		child.once("error", reject);
		child.once("close", (code) => {
			if (code === 0) resolve({ stdout, stderr });
			else reject(new Error((stdout + stderr).trim() || `${command} 退出码 ${code}`));
		});
	});
}

function needsActionId(operation: ActionPackageOperation): boolean {
	return operation === "scaffold" || operation === "validate";
}

/** Runs only the repository-provided action-package automation; no arbitrary command is exposed. */
export function createActionPackageToolDefinition(workspaceRoot: string, profile: AgentProfile): AnyToolDefinition {
	const plan = profile.actionPackage;
	if (!plan) throw new Error(`${profile.id} 未配置 actionPackage`);
	return {
		name: "action-package",
		label: "action-package",
		description: "Run the fixed parameterless-v1 servo action-package scaffold, validation, or release builder. It never accepts shell commands or paths.",
		promptSnippet: "Run the configured action-package automation",
		promptGuidelines: ["Use only an operation configured for this stage; report the returned JSON verbatim."],
		parameters,
		async execute(_toolCallId, args, signal) {
			const input = args as { operation: ActionPackageOperation; actionId?: string; description?: string; start?: "left" | "right" | "both" | "none"; intentExamples?: string[] };
			const operation = input.operation;
			if (!plan.operations.includes(operation)) throw new Error(`${profile.id} 不允许 action-package 操作：${operation}`);
			const actionId = input.actionId;
			if (needsActionId(operation) && !actionId) throw new Error(`${operation} 必须提供 actionId`);
			const script = join(workspaceRoot, "tools", "servo_action.py");
			await access(script);
			const command = operation === "scaffold" ? "new" : operation;
			const metadata = operation === "scaffold"
				? ["--description", input.description!, "--start", input.start!, ...input.intentExamples!.flatMap((intent) => ["--intent", intent])]
				: [];
			const result = await run("python3", [script, command, ...(actionId ? [actionId] : []), ...metadata], workspaceRoot, signal);
			return { content: [{ type: "text", text: result.stdout.trim() || result.stderr.trim() }], details: undefined };
		},
	};
}
