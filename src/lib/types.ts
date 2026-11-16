import type { Segment } from '#lib/segment-diff.js';
export type { Segment };

export const efforts = ['quick', 'deep'] as const;
export type Effort = (typeof efforts)[number];
export const isEffort = (value: unknown): value is Effort => (efforts as readonly unknown[]).includes(value);
export const effortLabels: Record<Effort, string> = { quick: 'Quick', deep: 'Deeper' };
// rev counts saved triage changes for a post, so a client can tell an older poll from a newer one
export type Triage = { nextStep: string | null; effort: Effort | null; rev: number };
export const nextStepLimit = 140;
export const triageFields = ['nextStep', 'effort'] as const;
export type TriageField = (typeof triageFields)[number];
export const isTriageField = (value: unknown): value is TriageField => (triageFields as readonly unknown[]).includes(value);

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
	nextStep?: string | null;
	effort?: Effort | null;
	triageRev?: number;
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
	editedAfterStaging?: string[];
	push: { ok: boolean; status: number | null; output: string };
	results: PublishResult[];
};

export type PublicationRemoteState = {
	capturedCommit: string;
	remoteCommit: string;
	baseCommit: string;
	differences: {
		path: string;
		kind: 'deleted' | 'modified' | 'restored' | 'type-changed';
		matchesBefore: boolean;
	}[];
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
	editedAfterStaging: boolean;
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
