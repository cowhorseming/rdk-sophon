import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { AgentRunResult } from "../shared/agent-runner.ts";
import type { DeliveryValidationPlan } from "../domain/agent-profile.ts";
import { validateSkillPackage } from "./deployment-agent-tool.ts";

export interface DeliveryValidationContext {
	userRequest: string;
	writtenPaths?: ReadonlySet<string>;
}

function workspacePath(workspaceRoot: string, configuredPath: string): string {
	const root = resolve(workspaceRoot);
	const absolute = resolve(root, configuredPath);
	const pathFromRoot = relative(root, absolute);
	if (pathFromRoot === "" || pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`)) {
		throw new Error(`交付校验路径越出工作区：${configuredPath}`);
	}
	return absolute;
}

function manifestPluginId(contents: string): string {
	const match = contents.match(/^id\s*=\s*["']([a-z][a-z0-9-]*)["']\s*$/m);
	if (!match?.[1]) throw new Error("plugin.toml 缺少合法 id");
	return match[1];
}

function pythonContract(contents: string): { actions: ReadonlySet<string>; options: readonly string[] } {
	const actions = new Set<string>();
	const actionBlock = contents.match(/^ACTIONS\s*=\s*\{([\s\S]*?)^\}/m)?.[1] ?? "";
	for (const match of actionBlock.matchAll(/["']([a-z][a-z0-9-]*)["']\s*:/g)) actions.add(match[1]!);
	if (/args\.action\s*==\s*["']servo["']/.test(contents)) actions.add("servo");
	if (actions.size === 0) throw new Error("入口源码中未找到 ACTIONS 动作契约");
	const options = [...contents.matchAll(/add_argument\(\s*["'](--[a-z][a-z0-9-]*)["']/g)].map((match) => match[1]!);
	return { actions, options: [...new Set(options)] };
}

interface ManagedServoAction {
	module: string;
	start: "left" | "right" | "both" | "none";
}

async function managedServoActions(
	workspaceRoot: string,
	entrypointSource: string,
): Promise<ReadonlyMap<string, ManagedServoAction> | undefined> {
	const entrypoint = workspacePath(workspaceRoot, entrypointSource);
	const registryPath = join(dirname(entrypoint), "servo_actions", "actions.json");
	let contents: string;
	try {
		contents = await readFile(registryPath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(contents);
	} catch {
		throw new Error(`托管动作配置不是合法 JSON：${relative(workspaceRoot, registryPath)}`);
	}
	if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== 1) {
		throw new Error("托管动作配置必须使用 version=1");
	}
	const rawActions = (parsed as { actions?: unknown }).actions;
	if (!rawActions || typeof rawActions !== "object" || Array.isArray(rawActions)) {
		throw new Error("托管动作配置缺少 actions 对象");
	}
	const actions = new Map<string, ManagedServoAction>();
	for (const [name, rawEntry] of Object.entries(rawActions)) {
		if (!/^[a-z][a-z0-9-]*$/.test(name) || !rawEntry || typeof rawEntry !== "object") {
			throw new Error(`托管动作配置包含非法动作：${name}`);
		}
		const entry = rawEntry as { module?: unknown; start?: unknown };
		const expectedModule = `${name.replaceAll("-", "_")}.py`;
		if (entry.module !== expectedModule || !["left", "right", "both", "none"].includes(String(entry.start))) {
			throw new Error(`托管动作 ${name} 的 module/start 配置无效`);
		}
		actions.set(name, entry as ManagedServoAction);
	}
	return actions;
}

function normalizedPluginCommands(contents: string, pluginId: string): ReadonlySet<string> {
	const commands = new Set<string>();
	for (const match of contents.matchAll(/sophonctl\s+(?:--board\s+\S+\s+)?([a-z][a-z0-9-]*)(?:\s+([^`\n|]+))?/g)) {
		if (match[1] !== pluginId) continue;
		commands.add(`${pluginId} ${(match[2] ?? "").trim().replace(/\s+/g, " ")}`.trim());
	}
	return commands;
}

function validateCommands(contents: string, label: string, pluginId: string, actions: ReadonlySet<string>): void {
	const commands = [...contents.matchAll(/`(sophonctl\s+[^`\n]+)`/g)].map((match) => match[1]!);
	if (commands.length === 0) throw new Error(`${label} 未包含任何可核对的 sophonctl 命令`);
	for (const command of commands) {
		const tokens = command.trim().split(/\s+/);
		let index = 1;
		if (tokens[index] === "--board") index += 2;
		const rootCommand = tokens[index];
		if (rootCommand === "plugins") continue;
		if (rootCommand !== pluginId) {
			throw new Error(`${label} 的命令缺少插件名 ${pluginId}：${command}`);
		}
		const action = tokens[index + 1];
		if (!action || action === "--help") continue;
		if (!actions.has(action)) throw new Error(`${label} 引用了入口源码不存在的动作 ${action}：${command}`);
	}
}

function validateEvidenceReferences(acceptance: string, evidence: ReadonlyMap<string, string>): void {
	const allEvidence = [...evidence.values()].join("\n");
	const testReferences = (contents: string): string[] => [...contents.matchAll(/\b(test_[a-zA-Z0-9_]+)\b/g)]
		.filter((match) => contents.slice((match.index ?? 0) + match[1]!.length, (match.index ?? 0) + match[1]!.length + 3) !== ".py")
		.map((match) => match[1]!);
	const referencedTests = testReferences(acceptance);
	for (const testName of new Set(referencedTests)) {
		if (!new RegExp(`\\b${testName}\\b`).test(allEvidence)) {
			throw new Error(`acceptance.md 引用了不存在的测试：${testName}`);
		}
	}
	for (const line of acceptance.split(/\r?\n/)) {
		const testsOnLine = testReferences(line);
		const mentionedFiles = [...evidence.keys()].filter((file) => line.includes(file));
		if (testsOnLine.length === 0 || mentionedFiles.length === 0) continue;
		const namedEvidence = mentionedFiles.map((file) => evidence.get(file) ?? "").join("\n");
		for (const testName of testsOnLine) {
			if (!new RegExp(`\\b${testName}\\b`).test(namedEvidence)) {
				throw new Error(`acceptance.md 把 ${testName} 错误归属到 ${mentionedFiles.join(", ")}`);
			}
		}
	}
}

function validateRequiredServoAcceptance(acceptance: string, evidence: ReadonlyMap<string, string>): void {
	const errors: string[] = [];
	const allEvidence = [...evidence.values()].join("\n");
	const sides = (["left", "right"] as const).filter((side) => acceptance.includes(`wave-${side}-hand`));
	if (sides.length === 0) errors.push("未识别本次左手或右手新动作");
	for (const side of sides) {
		const chineseSide = side === "left" ? "左手" : "右手";
		for (const testName of [`test_wave_${side}_hand_sequence`, `test_wave_${side}_hand_is_${side}_only_action`]) {
			if (!new RegExp(`\\b${testName}\\b`).test(allEvidence)) errors.push(`测试证据中不存在 ${testName}`);
			else if (!new RegExp(`\\b${testName}\\b`).test(acceptance)) errors.push(`缺少${chineseSide}动作核心证据 ${testName}`);
		}
		const physicalBoundary = new RegExp(`实际只动${chineseSide}[^\\n]*(?:后续|最终)[^\\n]*真机验收[^\\n]*(?:命令成功|exit=0)[^\\n]*(?:自动验收|验收结果)`);
		if (!physicalBoundary.test(acceptance)) {
			errors.push(`缺少${chineseSide}真实动作由真机 Agent 自动验收的边界`);
		}
	}
	if (!/动作式[^\n]*(?:不需要|无需|不得[^\n]*再次)[^\n]*(?:二次确认|再次确认)/.test(acceptance)) {
		errors.push("缺少动作式自然语言无需二次确认的验收边界");
	}
	if (errors.length > 0) throw new Error(`acceptance.md 缺少端到端必验项：${errors.join("；")}`);
}

function validateAcceptanceClaims(acceptance: string, options: readonly string[], entrypoint: string): void {
	const errors: string[] = [];
	const lines = acceptance.split(/\r?\n/);
	if (options.length > 0 && /无任何参数|无其他参数[^\n]*CLI|不(?:接受|支持)任何参数|动作本身不接受任何参数/.test(acceptance)) {
		errors.push(`声称动作无参数，但入口源码存在通用选项：${options.join(", ")}`);
	}
	if (/\btest_[a-zA-Z0-9_]+[^\n]{0,120}(?:通过|成功)/.test(acceptance)) {
		errors.push("验收场景不能在验证 Agent 执行测试前预写测试已通过");
	}
	if (lines.some((line) => line.includes("[actions]") && /自然语言|映射|触发/.test(line))) {
		errors.push("错把 plugin.toml 的 [actions] 当作自然语言或执行映射；映射应由 Skill 和入口源码契约证明");
	}
	if (lines.some((line) => /CLI\s*命令/.test(line) && /plugin\.toml/.test(line) && /定义|提供|声明/.test(line))) {
		errors.push("错把 plugin.toml 当作具体 CLI 动作命令的定义来源；manifest 只提供插件 id 与 entrypoint");
	}
	if (/非\s*root\s*可写|依赖系统级部署权限|文件权限为/.test(acceptance)) {
		errors.push("包含无法从配置和源码证明的文件权限结论");
	}
	if (/额外参数[^\n]*(?:解析失败|导致[^\n]*失败)/.test(acceptance) && /add_argument\(\s*["']args["'][^\n]*nargs\s*=\s*["']\*["']/.test(entrypoint)) {
		errors.push("声称额外位置参数会解析失败，但入口使用 nargs='*' 接收它们");
	}
	if (/未在[^\n]*(?:plugin\.toml|servo_ctrl\.py)[^\n]*(?:不构成有效触发|无效触发)/.test(acceptance)) {
		errors.push("根据 plugin 或 Python 源码臆断自然语言不是有效触发；自然语言边界应由 Skill 定义");
	}
	if (/未启用\s*shell[^\n]*plugin\.toml|plugin\.toml[^\n]*(?:未配置|未定义|没有)[^\n]*shell/.test(acceptance)) {
		errors.push("根据 plugin.toml 中不存在的 shell 字段推断执行安全性");
	}
	if (/无\s*shell\s*注入风险|无资源泄漏|确保[^\n]*无[^\n]*泄漏/.test(acceptance)) {
		errors.push("包含未被测试证明的绝对安全或资源泄漏结论");
	}
	for (const line of lines.filter((item) => /test_main_dispatches_wave_(?:left|right)_hand/.test(item))) {
		if (/--hold|time\.sleep|延时|异常|sys\.exit|退出码|返回值/.test(line)) {
			errors.push("test_main_dispatches_wave_<side>_hand 只证明分发和左右启动隔离，不能证明参数、延时或异常行为");
			break;
		}
	}
	if (errors.length > 0) throw new Error(`acceptance.md 契约声明不准确：${errors.join("；")}`);
}

function globPattern(pattern: string): RegExp {
	return new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`);
}

async function loadEvidenceFiles(workspaceRoot: string, configuredPath: string): Promise<readonly [string, string][]> {
	const filePattern = basename(configuredPath);
	if (!filePattern.includes("*")) {
		return [[filePattern, await readFile(workspacePath(workspaceRoot, configuredPath), "utf8")]];
	}
	if (dirname(configuredPath).includes("*")) throw new Error(`交付校验证据只支持文件名通配符：${configuredPath}`);
	const directory = workspacePath(workspaceRoot, dirname(configuredPath));
	const names = (await readdir(directory)).filter((name) => globPattern(filePattern).test(name)).sort();
	if (names.length === 0) throw new Error(`交付校验证据通配符没有匹配文件：${configuredPath}`);
	return Promise.all(names.map(async (name) => [name, await readFile(join(directory, name), "utf8")] as const));
}

async function validateSkillContract(
	workspaceRoot: string,
	skillDirectory: string,
	plan: Extract<DeliveryValidationPlan, { kind: "skill-contract" }>,
): Promise<void> {
	const source = workspacePath(workspaceRoot, plan.source);
	const skill = await readFile(join(source, "SKILL.md"), "utf8");
	const acceptance = await readFile(join(source, "acceptance.md"), "utf8");
	const manifest = await readFile(workspacePath(workspaceRoot, plan.manifest), "utf8");
	const entrypoint = await readFile(workspacePath(workspaceRoot, plan.entrypointSource), "utf8");
	validateSkillPackage(skill, plan.skillName);
	if (acceptance.trim() === "") throw new Error("acceptance.md 不能为空");
	const pluginId = manifestPluginId(manifest);
	const staticContract = pythonContract(entrypoint);
	const actions = new Set(staticContract.actions);
	const managedActions = await managedServoActions(workspaceRoot, plan.entrypointSource);
	for (const action of managedActions?.keys() ?? []) actions.add(action);
	const contract = { actions, options: staticContract.options };
	validateCommands(skill, "SKILL.md", pluginId, contract.actions);
	validateCommands(acceptance, "acceptance.md", pluginId, contract.actions);
	validateAcceptanceClaims(acceptance, contract.options, entrypoint);

	const evidence = new Map<string, string>();
	for (const configuredPath of plan.evidenceFiles) {
		for (const [name, contents] of await loadEvidenceFiles(workspaceRoot, configuredPath)) evidence.set(name, contents);
	}
	validateEvidenceReferences(acceptance, evidence);
	validateRequiredServoAcceptance(acceptance, evidence);

	const baseline = await readFile(join(skillDirectory, plan.baselineSkillName, "SKILL.md"), "utf8");
	for (const command of normalizedPluginCommands(baseline, pluginId)) {
		if (!normalizedPluginCommands(skill, pluginId).has(command)) {
			throw new Error(`SKILL.md 丢失已安装 Skill 的既有命令：sophonctl ${command}`);
		}
	}
}

function requestedSingleHand(request: string): "left" | "right" | undefined {
	const left = /左手|wave[-_\s]?left[-_\s]?hand/i.test(request);
	const right = /右手|wave[-_\s]?right[-_\s]?hand/i.test(request);
	return left === right ? undefined : left ? "left" : "right";
}

async function validateServoPythonTest(
	workspaceRoot: string,
	context: DeliveryValidationContext,
): Promise<void> {
	const side = requestedSingleHand(context.userRequest);
	if (!side) return;
	const opposite = side === "left" ? "right" : "left";
	const expectedPath = `examples/plugins/servo/tests/test_wave_${side}_hand.py`;
	const oppositePath = `examples/plugins/servo/tests/test_wave_${opposite}_hand.py`;
	if (context.writtenPaths?.has(oppositePath)) {
		throw new Error(`本次是${side === "left" ? "左手" : "右手"}需求，测试 Agent 却修改了另一侧文件 ${oppositePath}`);
	}
	let contents: string;
	try {
		contents = await readFile(workspacePath(workspaceRoot, expectedPath), "utf8");
	} catch {
		throw new Error(`本次需求必须交付对应测试文件：${expectedPath}`);
	}
	const managedArchitecture = await managedServoActions(
		workspaceRoot,
		"examples/plugins/servo/servo_ctrl.py",
	) !== undefined;
	const requirements = managedArchitecture ? [
		`test_wave_${side}_hand_sequence`,
		`test_wave_${side}_hand_is_${side}_only_action`,
		"load_managed_action",
		`wave-${side}-hand`,
		`call.lift_${side}()`,
		"call.hold_visible_position()",
		`call.lower_${side}()`,
		`lift_${opposite}.assert_not_called`,
		`lower_${opposite}.assert_not_called`,
	] : [
		`test_wave_${side}_hand_sequence`,
		`test_wave_${side}_hand_is_${side}_only_action`,
		`wave_${side}_hand()`,
		`wave-${side}-hand`,
		`${side.toUpperCase()}_ONLY_ACTIONS`,
		"WAVE_POSITION_HOLD_SECONDS",
		"call.hold(WAVE_POSITION_HOLD_SECONDS)",
		`lift_${opposite}.assert_not_called`,
		`lower_${opposite}.assert_not_called`,
	];
	const missing = requirements.filter((item) => !contents.includes(item));
	if (managedArchitecture && !new RegExp(`assertEqual\\(\\s*start\\s*,\\s*["']${side}["']\\s*\\)`).test(contents)) {
		missing.push(`assertEqual(start, "${side}")`);
	}
	if (managedArchitecture) {
		const entrypoint = await readFile(workspacePath(
			workspaceRoot,
			"examples/plugins/servo/servo_ctrl.py",
		), "utf8");
		if (!/def\s+hold_visible_position\s*\([^)]*\)\s*:[\s\S]{0,240}time\.sleep\(WAVE_POSITION_HOLD_SECONDS\)/.test(entrypoint)) {
			missing.push("servo_ctrl.py 的 hold_visible_position() 必须使用 WAVE_POSITION_HOLD_SECONDS");
		}
	}
	if (missing.length > 0) throw new Error(`${expectedPath} 缺少本次单侧动作测试契约：${missing.join(", ")}`);
}

export async function validateDeliveryContract(
	workspaceRoot: string,
	skillDirectory: string,
	plan: DeliveryValidationPlan,
	context: DeliveryValidationContext = { userRequest: "" },
): Promise<void> {
	if (plan.kind === "skill-contract") await validateSkillContract(workspaceRoot, skillDirectory, plan);
	else if (plan.kind === "servo-python-test") await validateServoPythonTest(workspaceRoot, context);
}

export async function enforceDeliveryContract(
	result: AgentRunResult,
	workspaceRoot: string,
	skillDirectory: string,
	plan?: DeliveryValidationPlan,
	context: DeliveryValidationContext = { userRequest: "" },
): Promise<AgentRunResult> {
	if (!plan || result.outcome !== "completed") return result;
	try {
		await validateDeliveryContract(workspaceRoot, skillDirectory, plan, context);
		return result;
	} catch (error) {
		const feedback = error instanceof Error ? error.message : String(error);
		return {
			summary: `${result.summary}\n\n[确定性交付校验失败] ${feedback}`,
			outcome: "revision",
			feedback,
		};
	}
}
