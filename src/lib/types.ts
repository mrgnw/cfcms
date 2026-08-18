export type DeployStatus = 'draft' | 'ready' | 'live' | 'changed' | 'unpublish' | 'delete' | 'deleted';

export type PostListItem = {
	path: string;
	title: string;
	date?: string;
	tags?: string[];
	publish?: boolean;
	pin?: boolean;
	editingOrder?: number | null;
	deleteRequested?: boolean;
	slug?: string;
	excerpt?: string;
	updatedAt?: string;
	contentHash?: string;
	deployStatus?: DeployStatus;
	deployedAt?: string;
};

export type Post = PostListItem & {
	frontmatter: string;
	body: string;
};

export type LlmDraft = {
	path: string;
	body: string;
};

export type PublishResult = {
	name: string;
	ok: boolean;
	status: number | null;
	durationMs: number;
	output: string;
};

export type PublishData = {
	ok: boolean;
	readyCount: number;
	liveCount: number;
	lastPublishedAt: string | null;
	runAt: string;
	push: { ok: boolean; status: number | null; output: string };
	results: PublishResult[];
};

export type PostFilter = 'all' | 'ready' | 'drafts' | 'live';

export type PendingChange = {
	path: string;
	title: string;
	date: string;
	status: DeployStatus;
	words: number;
	added: number | null;
	deleted: number | null;
};

export type PostCounts = { all: number; drafts: number; ready: number; live: number; deleted: number };

export const pendingStatuses = new Set<DeployStatus>(['ready', 'changed', 'unpublish', 'delete']);

export const isPending = (status: DeployStatus = 'draft') => pendingStatuses.has(status);

export const statusOf = (post: Pick<PostListItem, 'deployStatus'>) => post.deployStatus ?? 'draft';

export const isEditing = (post: Pick<PostListItem, 'editingOrder'>) => post.editingOrder != null;
