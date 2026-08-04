import assert from "node:assert/strict";
import test from "node:test";
import {
	enforceTestExecutionEvidence,
	enforceVerificationEvidence,
	needsTestExecutionEvidenceRetry,
	testExecutionEvidenceRetryPrompt,
	needsVerificationEvidenceRetry,
	verificationEvidenceRetryPrompt,
} from "../../src/infra/verification-evidence.ts";

const passed = { summary: "looks good", outcome: "completed" } as const;

test("verification cannot pass without an executable check", () => {
	const result = enforceVerificationEvidence(passed, "verification", { sawBash: false, bashHadError: false });
	assert.equal(result.outcome, "revision");
	assert.match(result.feedback ?? "", /没有运行任何安全测试/);
});

test("a textual pass without Bash evidence gets one in-session evidence retry", () => {
	assert.equal(needsVerificationEvidenceRetry(passed, "verification", { sawBash: false, bashHadError: false }), true);
	assert.match(verificationEvidenceRetryPrompt, /必须立即调用 bash 工具/);
	assert.equal(needsVerificationEvidenceRetry(passed, "verification", { sawBash: true, bashHadError: false }), false);
});

test("verification cannot hide a failed Bash check behind a passed marker", () => {
	const result = enforceVerificationEvidence(passed, "verification", { sawBash: true, bashHadError: true });
	assert.equal(result.outcome, "revision");
	assert.match(result.feedback ?? "", /Bash 检查出现失败/);
});

test("verification with clean Bash evidence may pass", () => {
	const result = enforceVerificationEvidence(passed, "verification", { sawBash: true, bashHadError: false });
	assert.equal(result, passed);
});

test("non-verification stages keep their normal TDD red-test semantics", () => {
	const result = enforceVerificationEvidence(passed, "test", { sawBash: true, bashHadError: true });
	assert.equal(result, passed);
});

test("a Bash-capable test stage must really execute its test", () => {
	assert.equal(needsTestExecutionEvidenceRetry(passed, "test", true, { sawBash: false, bashHadError: false }), true);
	assert.match(testExecutionEvidenceRetryPrompt, /有效红测/);
	assert.equal(
		enforceTestExecutionEvidence(passed, "test", true, { sawBash: false, bashHadError: false }).outcome,
		"needs-human",
	);
	assert.equal(
		enforceTestExecutionEvidence(passed, "test", true, { sawBash: true, bashHadError: true }),
		passed,
	);
});

test("a declarative test stage without Bash is not forced to invent an executable check", () => {
	assert.equal(needsTestExecutionEvidenceRetry(passed, "test", false, { sawBash: false, bashHadError: false }), false);
	assert.equal(enforceTestExecutionEvidence(passed, "test", false, { sawBash: false, bashHadError: false }), passed);
});
