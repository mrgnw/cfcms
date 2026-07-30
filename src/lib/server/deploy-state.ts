import { env } from '$env/dynamic/private';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { contentBaseDirectory } from './paths';
import type { DeployStatus } from '$lib/types';

export type { DeployStatus };

export type DeployedPostState = {
	hash: string;
	title: string;
	slug: string;
	deployedAt: string;
};

export type DeployState = {
	version: 1;
	lastPublishedAt: string | null;
	posts: Record<string, DeployedPostState>;
};

type PublishedPost = {
	path: string;
	title: string;
	slug: string;
	publish: boolean;
	deleteRequested: boolean;
	contentHash: string;
};

const deployStatePath = resolve(
	env.BLOG_CMS_DEPLOY_STATE_FILE ?? resolve(contentBaseDirectory, '.cms/deploy-state.json')
);

const emptyDeployState = (): DeployState => ({
	version: 1,
	lastPublishedAt: null,
	posts: {}
});

export const hashPostContent = (frontmatter: string, body: string) =>
	createHash('sha256')
		.update(`${frontmatter.trim()}\n---\n${body.replace(/\s+$/, '')}`)
		.digest('hex');

export const readDeployState = async (): Promise<DeployState> => {
	try {
		const raw = await readFile(deployStatePath, 'utf8');
		const parsed = JSON.parse(raw) as DeployState;

		return {
			version: 1,
			lastPublishedAt: parsed.lastPublishedAt ?? null,
			posts: parsed.posts ?? {}
		};
	} catch (caught) {
		if (caught && typeof caught === 'object' && 'code' in caught && caught.code === 'ENOENT') {
			return emptyDeployState();
		}
		throw caught;
	}
};

export const getDeployStatus = (
	post: { publish: boolean; deleteRequested: boolean; contentHash: string },
	deployed?: DeployedPostState
): DeployStatus => {
	if (post.deleteRequested) return deployed ? 'delete' : 'deleted';
	if (post.publish) {
		if (!deployed) return 'ready';
		return deployed.hash === post.contentHash ? 'live' : 'changed';
	}
	return deployed ? 'unpublish' : 'draft';
};

export const writeDeployState = async (state: DeployState) => {
	await mkdir(dirname(deployStatePath), { recursive: true });
	const tempPath = `${deployStatePath}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
	await rename(tempPath, deployStatePath);
};

export const recordPublishedState = async (posts: PublishedPost[]) => {
	const deployedAt = new Date().toISOString();
	const state: DeployState = {
		version: 1,
		lastPublishedAt: deployedAt,
		posts: Object.fromEntries(
			posts
				.filter((post) => post.publish && !post.deleteRequested)
				.map((post) => [
					post.path,
					{
						hash: post.contentHash,
						title: post.title,
						slug: post.slug,
						deployedAt
					}
				])
		)
	};

	await writeDeployState(state);
	return state;
};
