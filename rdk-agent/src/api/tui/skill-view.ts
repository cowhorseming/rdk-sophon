import type { AgentProfile } from "../../domain/agent-profile.ts";
import type { AgentSkillInfo } from "../../shared/agent-runner.ts";

export function profileSkillStatus(
	profile: AgentProfile,
	loadedSkills?: readonly AgentSkillInfo[],
	selectedSkills?: readonly AgentSkillInfo[],
): string | undefined {
	if (profile.skills.length === 0) return undefined;
	const loaded = loadedSkills?.map((skill) => skill.name).join(", ") ?? "尚未创建会话";
	const selected = selectedSkills?.map((skill) => skill.name).join(", ") || "尚未选择";
	return `Skills：配置 ${profile.skills.join(", ")} · 已加载 ${loaded} · 本次选择 ${selected}`;
}

export function skillReport(
	profiles: readonly AgentProfile[],
	loadedByAgent: ReadonlyMap<string, readonly AgentSkillInfo[]>,
	selectedByAgent: ReadonlyMap<string, readonly AgentSkillInfo[]>,
): string {
	return profiles.map((profile) => {
		const configured = profile.skills.join(", ") || "无";
		const loaded = loadedByAgent.get(profile.id)?.map((skill) => `${skill.name} (${skill.filePath})`).join(", ") ?? "尚未创建会话";
		const selected = selectedByAgent.get(profile.id)?.map((skill) => skill.name).join(", ") || "尚未选择";
		return `[${profile.name}]\n配置：${configured}\n实际加载：${loaded}\n本次选择：${selected}`;
	}).join("\n\n");
}
