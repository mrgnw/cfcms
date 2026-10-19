import type { Segment } from '#lib/segment-diff.js';
export type { Segment };

export type DeployStatus = 'draft' | 'ready' | 'live' | 'changed' | 'unpublish' | 'delete' | 'deleted';

export type PostListItem = {
	id?: string;
	path: string;
	title: string;
	date?: string;
	tags?: string[];
	publish?: boolean;
	pin?: boolean;
	editingOrder?: number | null;
	deleteRequested?: boolean;
	slug: string;
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

export type FieldSegment = { name: string; yours: string; theirs: string };

export type WriterVersion = {
	writer: string;
	body: string;
	updatedAt: string;
	segments: Segment[] | null;
	fields: FieldSegment[] | null;
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
	stagedCount: number;
	liveCount: number;
	lastPublishedAt: string | null;
	runAt: string;
	push: { ok: boolean; status: number | null; output: string };
	results: PublishResult[];
};

export const stages = ['drafts', 'ready', 'live'] as const;
export type Stage = (typeof stages)[number];
export const isStage = (value: string): value is Stage => (stages as readonly string[]).includes(value);
export type PostFilter = 'all' | Stage;

export type PendingChange = {
	path: string;
	slug: string;
	title: string;
	date: string;
	status: DeployStatus;
	staged: boolean;
	blocked: boolean;
	words: number;
	added: number | null;
	deleted: number | null;
	segments: Segment[] | null;
};

export type PostCounts = { all: number; drafts: number; ready: number; live: number; deleted: number };

export const pendingStatuses = new Set<DeployStatus>(['ready', 'changed', 'unpublish', 'delete']);

export const isPending = (status: DeployStatus = 'draft') => pendingStatuses.has(status);

export const statusOf = (post: Pick<PostListItem, 'deployStatus'>) => post.deployStatus ?? 'draft';

export const isEditing = (post: Pick<PostListItem, 'editingOrder'>) => post.editingOrder != null;

export const countPosts = (posts: PostListItem[]): PostCounts => {
	const active = posts.filter((post) => !post.deleteRequested);
	return {
		all: active.length,
		drafts: active.filter((post) => statusOf(post) === 'draft').length,
		ready: active.filter((post) => isPending(statusOf(post))).length,
		live: active.filter((post) => statusOf(post) === 'live').length,
		deleted: posts.length - active.length
	};
};
