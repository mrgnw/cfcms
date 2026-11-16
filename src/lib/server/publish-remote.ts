import type { PublicationRemoteState } from '#lib/types.js';
import { assertCheckoutWriteLock } from './checkout-lock';
import { runGit } from './git';

const commitPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const kinds = { A: 'restored', D: 'deleted', M: 'modified', T: 'type-changed' } as const;

export const parsePublicationRemoteState = (value: string | null): PublicationRemoteState | null => {
	if (!value) return null;
	try {
		const state = JSON.parse(value) as PublicationRemoteState;
		if (!state || !commitPattern.test(state.capturedCommit) || !commitPattern.test(state.remoteCommit)
			|| !commitPattern.test(state.baseCommit) || !Array.isArray(state.differences)
			|| !state.differences.every((entry) => entry && typeof entry.path === 'string'
				&& Object.values(kinds).includes(entry.kind) && typeof entry.matchesBefore === 'boolean')) return null;
		return state;
	} catch {
		return null;
	}
};

const readTreeChanges = async (before: string, after: string) => {
	const result = await runGit([
		'--no-replace-objects', 'diff', '--raw', '--no-abbrev', '--no-renames', '--no-ext-diff', '--no-textconv',
		'--no-color', '-z', before, after, '--'
	], 10_000, { stdoutOnly: true, outputLimit: 4 * 1024 * 1024 });
	if (!result.ok || result.truncated) throw new Error('Cannot show the complete current remote path comparison; Git failed or its output exceeded 4 MiB.');
	const tokens = result.output.split('\0');
	if (tokens.pop() !== '' || tokens.length % 2) throw new Error('Invalid Git path comparison output');
	const changes = new Map<string, { before: string; after: string; kind: PublicationRemoteState['differences'][number]['kind'] }>();
	for (let index = 0; index < tokens.length; index += 2) {
		const entry = /^:(\d{6}) (\d{6}) ([0-9a-f]{40}(?:[0-9a-f]{24})?) ([0-9a-f]{40}(?:[0-9a-f]{24})?) ([ADMT])$/.exec(tokens[index]);
		if (!entry || !tokens[index + 1]) throw new Error('Unsupported Git path comparison record');
		changes.set(tokens[index + 1], {
			before: `${entry[1]}:${entry[3]}`, after: `${entry[2]}:${entry[4]}`, kind: kinds[entry[5] as keyof typeof kinds]
		});
	}
	return changes;
};

export const comparePublicationRemote = async (captured: string, remote: string): Promise<PublicationRemoteState> => {
	assertCheckoutWriteLock();
	if (!commitPattern.test(captured) || !commitPattern.test(remote)) throw new Error('Invalid publication comparison commit');
	const base = await runGit(['--no-replace-objects', 'merge-base', '--all', captured, remote], 10_000);
	if (!base.ok || !commitPattern.test(base.output.trim())) throw new Error('Cannot identify the captured path comparison base');
	let baseCommit = base.output.trim();
	if (baseCommit === captured) {
		const parent = await runGit(['--no-replace-objects', 'rev-parse', '--verify', `${captured}^1`], 10_000);
		if (!parent.ok || !commitPattern.test(parent.output.trim())) throw new Error('Cannot identify captured paths before the root commit');
		baseCommit = parent.output.trim();
	}
	const capturedChanges = await readTreeChanges(baseCommit, captured);
	const currentChanges = await readTreeChanges(captured, remote);
	const differences: PublicationRemoteState['differences'] = [];
	for (const [path, change] of currentChanges) {
		const original = capturedChanges.get(path);
		if (original) differences.push({ path, kind: change.kind, matchesBefore: change.after === original.before });
	}
	return { capturedCommit: captured, remoteCommit: remote, baseCommit, differences };
};
