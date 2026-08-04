import type { AgentExpectation, AgentRunResult } from "../shared/agent-runner.ts";

export interface VerificationToolEvidence {
	sawBash: boolean;
	bashHadError: boolean;
}

export function needsVerificationEvidenceRetry(
	result: AgentRunResult,
	expectation: AgentExpectation,
	evidence: VerificationToolEvidence,
): boolean {
	return expectation === "verification" && result.outcome === "completed" && !evidence.sawBash;
}

export const verificationEvidenceRetryPrompt = `运行时拒绝了你刚才没有执行测试的 passed 结论。
现在不要继续读取或复述文件，必须立即调用 bash 工具，亲自运行上游交付中与当前阶段对应的精确 mock/静态测试命令。
命令成功后才能返回 passed；命令失败则返回 revision 并给出真实错误。最后仍须输出单行 RDK_AGENT_RESULT。`;

export function needsTestExecutionEvidenceRetry(
	result: AgentRunResult,
	expectation: AgentExpectation,
	hasBashTool: boolean,
	evidence: VerificationToolEvidence,
): boolean {
	return expectation === "test" && hasBashTool && result.outcome === "completed" && !evidence.sawBash;
}

export const testExecutionEvidenceRetryPrompt = `运行时拒绝了你刚才没有真实执行测试的完成结论。
现在不要继续编辑文件，必须立即调用 bash 工具运行本阶段刚创建或修改的精确测试文件，并根据真实输出重新报告：
- 功能已存在时，测试为绿色可以正常交付；
- 功能尚未存在时，只有目标功能断言失败才是有效红测；
- 导入、路径、收集、fixture 或 mock 错误必须先修复，不能冒充红测。
最后仍须输出单行 RDK_AGENT_RESULT。`;

/** A Bash-capable test designer must execute its test at least once before handoff. */
export function enforceTestExecutionEvidence(
	result: AgentRunResult,
	expectation: AgentExpectation,
	hasBashTool: boolean,
	evidence: VerificationToolEvidence,
): AgentRunResult {
	if (expectation !== "test" || !hasBashTool || result.outcome !== "completed" || evidence.sawBash) return result;
	return {
		summary: result.summary,
		outcome: "needs-human",
		question: "测试设计 Agent 没有运行本阶段测试，无法确认是有效红测或绿色回归。请补充方向后重试，或输入 /abort 终止。",
	};
}

/** A verifier cannot turn a missing or finally-failed executable check into a textual pass. */
export function enforceVerificationEvidence(
	result: AgentRunResult,
	expectation: AgentExpectation,
	evidence: VerificationToolEvidence,
): AgentRunResult {
	if (expectation !== "verification" || result.outcome !== "completed") return result;
	if (!evidence.sawBash) {
		return {
			summary: result.summary,
			outcome: "revision",
			feedback: "验证 Agent 没有运行任何安全测试命令，不能判定 passed。请执行约定的 mock/静态测试。",
		};
	}
	if (evidence.bashHadError) {
		return {
			summary: result.summary,
			outcome: "revision",
			feedback: "验证 Agent 的 Bash 检查出现失败，却返回了 passed。请先修复失败并在新的验证轮中全部跑绿。",
		};
	}
	return result;
}
