export type StageId = string;

export interface PodmanSandboxPlan {
	kind: "podman";
	/** Container image reference used for Bash/test execution. */
	image: string;
	/** Development sandboxes are deliberately offline. */
	network: "none";
}

/**
 * Optional board-side sandbox retained for configurations that run tests on
 * the development board. It uses a disposable, hardware-free bwrap process.
 */
export interface SshBwrapSandboxPlan {
	kind: "ssh-bwrap";
	host: string;
	remoteRoot: string;
	network: "none";
	hardwareAccess: false;
	commandTimeoutSeconds: number;
}

export type SandboxExecutionPlan = PodmanSandboxPlan | SshBwrapSandboxPlan;

export interface SshDeploymentArtifact {
	source: string;
	target: string;
	mode: string;
	/** Deploy a directory atomically instead of a single file. */
	recursive?: boolean;
}

export interface SshDeploymentPlan {
	kind: "ssh";
	host: string;
	artifacts: readonly SshDeploymentArtifact[];
}

export interface SkillDeploymentPlan {
	kind: "skill";
	source: string;
	skillName: string;
	/** Package-relative runtime files to overlay; omitted installs the full source directory. */
	runtimeFiles?: readonly string[];
}

export type DeploymentPlan = SshDeploymentPlan | SkillDeploymentPlan;

export interface SkillContractValidationPlan {
	kind: "skill-contract";
	/** Workspace-relative directory containing SKILL.md and acceptance.md. */
	source: string;
	skillName: string;
	/** Workspace-relative sophonctl plugin manifest. */
	manifest: string;
	/** Workspace-relative executable source used to validate actions and options. */
	entrypointSource: string;
	/** Workspace-relative test sources that acceptance.md may cite as evidence. */
	evidenceFiles: readonly string[];
	/** Installed Skill used as the backward-compatibility baseline. */
	baselineSkillName: string;
}

export type DeliveryValidationPlan = SkillContractValidationPlan;

export interface AgentProfile {
	id: StageId;
	name: string;
	description: string;
	tools: readonly string[];
	skills: readonly string[];
	systemPrompt: string;
	/** Workspace-relative glob patterns that edit/write may mutate. */
	writePaths: readonly string[];
	timeoutSeconds: number;
	/** Omitted means tool calls are unlimited for this Agent stage. */
	maxToolCalls?: number;
	/** Optional isolated execution backend for Bash; file tools remain path-policy controlled. */
	sandbox?: SandboxExecutionPlan;
	/** Deterministic delivery plan exposed through the deploy tool. */
	deployment?: DeploymentPlan;
	/** Deterministic postcondition checked after an Agent reports success. */
	validation?: DeliveryValidationPlan;
}
