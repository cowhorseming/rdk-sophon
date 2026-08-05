import type { AgentProfile } from "../domain/agent-profile.ts";
import type { OrchestrationMode } from "../domain/orchestration-mode.ts";

export interface ManagedTemplateWorkspaceConfiguration {
	kind: "managed-template";
	id: string;
	version: number;
	templateDirectory: string;
	requiredPaths: readonly string[];
}

export interface CurrentDirectoryWorkspaceConfiguration {
	kind: "current-directory";
	requiredPaths: readonly string[];
}

export type WorkspaceConfiguration = ManagedTemplateWorkspaceConfiguration | CurrentDirectoryWorkspaceConfiguration;

export interface RequestIntakeConfiguration {
	autoStartConfidence: number;
	timeoutSeconds: number;
	developmentScope: string;
}

export interface AgentConfiguration {
	configDirectory: string;
	skillDirectory: string;
	profiles: readonly AgentProfile[];
	modes: readonly OrchestrationMode[];
	defaultModeId: string;
	workspace: WorkspaceConfiguration;
	intake: RequestIntakeConfiguration;
}

export interface AgentConfigurationLoader {
	load(configDirectory: string): AgentConfiguration;
}
