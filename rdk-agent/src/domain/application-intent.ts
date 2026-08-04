const readOnlyRequestMarkers = [
	/[?？]\s*$/,
	/(哪些|什么|怎么|怎样|如何|为什么|是否|能否|可以吗|能不能|有没有|支持吗)/,
	/(查看|查询|列出|介绍|说明|告诉我|了解).*(能力|命令|状态|配置|列表|Skill|skill|动作)/,
	/(当前|已经|已).*(加载|配置|支持)/,
	/(加载|配置|支持).*(哪些|什么|情况|状态)/,
];

/** Queries are read-only even in robot-application mode; all other imperative text remains action-authorized. */
export function isReadOnlyApplicationRequest(request: string): boolean {
	const normalized = request.trim();
	return readOnlyRequestMarkers.some((pattern) => pattern.test(normalized));
}
