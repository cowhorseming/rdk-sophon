export type ConversationCategory = "greeting" | "thanks" | "informational" | "other";

export interface DevelopmentCapability {
	id: string;
	name: string;
	description: string;
}

export type RequestIntentDecision =
	| {
		kind: "development";
		confidence: number;
		normalizedRequest: string;
		reasonCode: string;
	}
	| {
		kind: "conversation";
		confidence: number;
		category: ConversationCategory;
		reasonCode: string;
	}
	| {
		kind: "clarification";
		confidence: number;
		question: string;
		reasonCode: string;
	}
	| {
		kind: "unsupported-development";
		confidence: number;
		reason: string;
		reasonCode: string;
	};

const greeting = /^(?:你好|您好|嗨|哈[喽啰]|hi|hello|hey)[\s!！。,.，]*$/i;
const thanks = /^(?:谢谢|感谢|多谢|辛苦了|再见|拜拜|bye)[\s!！。,.，]*$/i;

/** High-precision fast paths only; mixed or semantic requests go to the classifier Agent. */
export function obviousConversationIntent(request: string): RequestIntentDecision | undefined {
	const normalized = request.trim();
	if (greeting.test(normalized)) {
		return { kind: "conversation", confidence: 1, category: "greeting", reasonCode: "exact-greeting" };
	}
	if (thanks.test(normalized)) {
		return { kind: "conversation", confidence: 1, category: "thanks", reasonCode: "exact-thanks" };
	}
	return undefined;
}

export function conversationReply(category: ConversationCategory): string {
	if (category === "greeting") return "你好！当前处于机器人研发模式。请描述要新增、修改、修复或测试的机器人能力。";
	if (category === "thanks") return "不客气。研发流程未启动；需要继续时直接描述目标能力即可。";
	if (category === "informational") return "这条消息被识别为咨询信息，研发流程未启动。若要实际修改能力，请明确说明要新增或调整的行为。";
	return "该用户指令没有明确要求研发，因此没有启动研发流程。";
}
