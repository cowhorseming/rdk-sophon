import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const skillDirectory = join(import.meta.dirname, "../../config/skills/servo-control");
const skill = readFileSync(join(skillDirectory, "SKILL.md"), "utf8");
const acceptance = readFileSync(join(skillDirectory, "acceptance.md"), "utf8");

test("servo Skill preserves wave-hands and exposes wave-left-hand", () => {
	assert.match(skill, /^---\nname: servo-control\n/);
	assert.match(skill, /^- `wave-hands`$/m);
	assert.match(skill, /^- `wave-left-hand`$/m);
	assert.match(skill, /先动左手再动右手|左右手协调摆动/);
	assert.match(skill, /`sophonctl servo wave-hands`/);
	assert.match(skill, /`sophonctl servo wave-left-hand`/);
});

test("servo Skill acceptance separates static checks from automated live acceptance", () => {
	assert.match(acceptance, /test_wave_left_hand_sequence/);
	assert.match(acceptance, /test_main_dispatches_wave_left_hand/);
	assert.match(acceptance, /实际只动左手由后续真机验收 Agent 执行/);
	assert.match(skill, /命令链路验收通过，未采集舵机位置反馈/);
	assert.doesNotMatch(skill, /物理效果待人类确认/);
	assert.doesNotMatch(acceptance, /\[x\]|Verification Status|entrypoint=servo_ctrl:main/);
	assert.doesNotMatch(acceptance, /test_wave_left_hand_no_args|test_wave_left_hand_does_not_call_right/);
});

test("servo Skill executes imperative application requests without a second confirmation", () => {
	assert.match(skill, /动作式自然语言就是对映射动作的一次执行授权/);
	assert.match(skill, /直接执行唯一映射命令一次/);
	assert.match(skill, /`sophonctl servo shake-ears`/);
	assert.match(skill, /不得停在列表或帮助检查/);
	assert.match(acceptance, /动作式输入不需要二次确认/);
});
