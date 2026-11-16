import { error } from '@sveltejs/kit';
import { canonicalBody } from '#lib/post-body.js';
import { normalizeNewlines } from '#lib/save-rules.js';
import type { AssistantDraftText, WriterVersion } from './db';

export const assistantDraftMaxBytes = 128 * 1024;
export const assistantRequestMaxBytes = 256 * 1024;
export const assistantEditLimit = 32;

type DraftEdit = { field: 'frontmatter' | 'body'; find: string; replace: string };
type Replacement = AssistantDraftText & { revision: string | null };
type Patch = { revision: string; edits: DraftEdit[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const hasKeys = (value: Record<string, unknown>, keys: string[]) =>
	Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

const isRevision = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0 && value.length <= 128;

const assistantTextSize = (text: AssistantDraftText) => Buffer.byteLength(text.frontmatter) + Buffer.byteLength(text.body);

const checkAssistantSize = (text: AssistantDraftText, maximumBytes: number) => {
	if (assistantTextSize(text) > maximumBytes) {
		throw error(413, 'Assistant draft exceeds 128 KiB');
	}
};

export const normalizeAssistantText = (text: AssistantDraftText, maximumBytes = assistantDraftMaxBytes): AssistantDraftText => {
	checkAssistantSize(text, maximumBytes);
	return {
		baseHash: text.baseHash,
		frontmatter: normalizeNewlines(text.frontmatter).trim(),
		body: canonicalBody(normalizeNewlines(text.body))
	};
};

export const parseAssistantReplacement = (value: unknown): Replacement => {
	if (!isRecord(value) || !hasKeys(value, ['revision', 'baseHash', 'frontmatter', 'body'])) {
		throw error(400, 'Expected revision, baseHash, frontmatter and body');
	}
	if (value.revision !== null && !isRevision(value.revision)) throw error(400, 'Invalid revision');
	if (typeof value.baseHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.baseHash)) {
		throw error(400, 'Invalid baseHash');
	}
	if (typeof value.frontmatter !== 'string' || typeof value.body !== 'string') {
		throw error(400, 'frontmatter and body must be strings');
	}
	return { revision: value.revision, ...normalizeAssistantText({
		baseHash: value.baseHash, frontmatter: value.frontmatter, body: value.body
	}) };
};

export const parseAssistantPatch = (value: unknown): Patch => {
	if (!isRecord(value) || !hasKeys(value, ['revision', 'edits']) || !isRevision(value.revision)) {
		throw error(400, 'Expected revision and edits');
	}
	if (!Array.isArray(value.edits) || value.edits.length < 1 || value.edits.length > assistantEditLimit) {
		throw error(400, 'Expected 1 to 32 edits');
	}
	const edits = value.edits.map((edit): DraftEdit => {
		if (!isRecord(edit) || !hasKeys(edit, ['field', 'find', 'replace'])) throw error(400, 'Invalid edit');
		if (edit.field !== 'frontmatter' && edit.field !== 'body') throw error(400, 'Invalid edit field');
		if (typeof edit.find !== 'string' || edit.find.length === 0 || typeof edit.replace !== 'string') {
			throw error(400, 'Each edit requires nonempty find text and a replace string');
		}
		return { field: edit.field, find: edit.find, replace: edit.replace };
	});
	return { revision: value.revision, edits };
};

export const patchAssistantText = (draft: WriterVersion | null, edits: DraftEdit[]): AssistantDraftText => {
	if (!draft) throw error(409, 'No assistant draft to edit');
	const originalBytes = assistantTextSize(draft);
	const maximumBytes = Math.max(assistantDraftMaxBytes, originalBytes);
	let text: AssistantDraftText = { baseHash: draft.baseHash, frontmatter: draft.frontmatter, body: draft.body };
	for (const edit of edits) {
		const current = text[edit.field];
		const start = current.indexOf(edit.find);
		if (start === -1 || current.indexOf(edit.find, start + 1) !== -1) {
			throw error(409, 'Edit find text must match exactly once');
		}
		text = {
			...text,
			[edit.field]: current.slice(0, start) + edit.replace + current.slice(start + edit.find.length)
		};
		checkAssistantSize(text, maximumBytes);
	}
	const normalized = normalizeAssistantText(text, maximumBytes);
	const finalBytes = assistantTextSize(normalized);
	if (finalBytes > assistantDraftMaxBytes && finalBytes >= originalBytes) {
		throw error(413, 'Oversized imported drafts must shrink with each patch');
	}
	return normalized;
};

export const assistantDraftView = (draft: WriterVersion | null) => draft ? ({
	revision: draft.revision,
	baseHash: draft.baseHash,
	frontmatter: draft.frontmatter,
	body: draft.body,
	updatedAt: draft.updatedAt
}) : null;
