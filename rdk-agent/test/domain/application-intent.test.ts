import assert from "node:assert/strict";
import test from "node:test";
import { isReadOnlyApplicationRequest } from "../../src/domain/application-intent.ts";

test("application intent keeps capability and Skill questions read-only", () => {
	for (const request of [
		"当前加载了哪些 Skill？",
		"舵机支持什么动作",
		"怎么让机器人摇耳朵？",
		"查看舵机命令列表",
		"机器人现在是什么状态",
	]) {
		assert.equal(isReadOnlyApplicationRequest(request), true, request);
	}
});

test("application intent authorizes imperative robot requests", () => {
	for (const request of ["摇一下耳朵", "站起来", "先动左手再动右手", "把右手放下"]) {
		assert.equal(isReadOnlyApplicationRequest(request), false, request);
	}
});
