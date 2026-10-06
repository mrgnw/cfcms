export const mainBranchError = (branch: string | null) =>
	branch === 'main'
		? null
		: `Blog checkout is on branch "${branch ?? 'unknown'}", not main; refusing to publish.`;
