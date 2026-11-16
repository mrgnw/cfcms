import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { changeAssistantDraft, getAssistantDraft, getStoredPost } from '#lib/server/db.js';
import {
	assistantDraftView, assistantRequestMaxBytes, parseAssistantPatch, parseAssistantReplacement,
	patchAssistantText
} from '#lib/server/assistant-draft.js';

const postPath = (url: URL) => {
	const path = url.searchParams.get('path');
	if (!path || path.length > 1024 || path.endsWith('.llm.md') || !path.endsWith('.md') ||
		path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
		throw error(400, 'path must be a relative human post path ending in .md');
	}
	return path;
};

const readJson = async (request: Request, url: URL): Promise<unknown> => {
	const origin = request.headers.get('origin');
	if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
		throw error(403, 'Cross-origin draft writes are not allowed');
	}
	if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
		throw error(415, 'Content-Type must be application/json');
	}
	if (Number(request.headers.get('content-length') ?? 0) > assistantRequestMaxBytes) {
		throw error(413, 'Request exceeds 256 KiB');
	}
	const reader = request.body?.getReader();
	if (!reader) throw error(400, 'JSON body is required');
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > assistantRequestMaxBytes) {
				throw error(413, 'Request exceeds 256 KiB');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
	} catch {
		throw error(400, 'Invalid JSON');
	}
};

export const GET: RequestHandler = ({ url }) => {
	const path = postPath(url);
	const post = getStoredPost(path);
	if (!post) throw error(404, `Unknown post: ${path}`);
	return Response.json({ path, humanContentHash: post.hash, draft: assistantDraftView(getAssistantDraft(path)) });
};

export const PUT: RequestHandler = async ({ request, url }) => {
	const path = postPath(url);
	const input = parseAssistantReplacement(await readJson(request, url));
	const result = changeAssistantDraft(path, input.revision, (_draft, post) => {
		if (input.baseHash !== post.hash) throw error(409, 'Human version changed; read the post again');
		return input;
	});
	if (result.outcome === 'missing') throw error(404, `Unknown post: ${path}`);
	if (result.outcome === 'conflict') throw error(409, 'Assistant draft changed; read the draft again');
	return Response.json({ path, draft: assistantDraftView(result.draft) }, { status: input.revision === null ? 201 : 200 });
};

export const PATCH: RequestHandler = async ({ request, url }) => {
	const path = postPath(url);
	const input = parseAssistantPatch(await readJson(request, url));
	const result = changeAssistantDraft(path, input.revision, (draft) => patchAssistantText(draft, input.edits));
	if (result.outcome === 'missing') throw error(404, `Unknown post: ${path}`);
	if (result.outcome === 'conflict') throw error(409, 'Assistant draft changed; read the draft again');
	return Response.json({ path, draft: assistantDraftView(result.draft) });
};
