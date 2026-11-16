import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'cms-remote-comparison-'));
const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
execFileSync('git', ['init', '-q', '-b', 'main', root]);
git('config', 'user.name', 'CMS Test');
git('config', 'user.email', 'cms-test@example.test');
git('config', 'commit.gpgsign', 'false');
for (const name of ['changed.md', 'removed.md', 'type.md', 'tab\tpost.md']) writeFileSync(join(root, name), 'Before publication.\n');
git('add', '.');
git('commit', '-qm', 'base');
const base = git('rev-parse', 'HEAD');
for (const name of ['changed.md', 'type.md', 'tab\tpost.md', 'added.md']) writeFileSync(join(root, name), 'Captured publication.\n');
rmSync(join(root, 'removed.md'));
git('add', '-A');
git('commit', '-qm', 'captured publication');
const captured = git('rev-parse', 'HEAD');
writeFileSync(join(root, 'changed.md'), 'Before publication.\n');
writeFileSync(join(root, 'removed.md'), 'Before publication.\n');
writeFileSync(join(root, 'tab\tpost.md'), 'A later independent edit.\n');
writeFileSync(join(root, 'unrelated.md'), 'Not part of this captured publication.\n');
rmSync(join(root, 'added.md'));
rmSync(join(root, 'type.md'));
symlinkSync('changed.md', join(root, 'type.md'));
git('add', '-A');
git('commit', '-qm', 'remote changes and reverts');
const remote = git('rev-parse', 'HEAD');
process.env.BLOG_CONTENT_BASE_DIR = root;
const { withCheckoutLock } = await import('./checkout-lock.ts');
const { comparePublicationRemote, parsePublicationRemoteState } = await import('./publish-remote.ts');

try {
	const index = readFileSync(join(root, '.git/index'));
	const before = git('status', '--porcelain');
	const state = await withCheckoutLock(() => comparePublicationRemote(captured, remote));
	assert.equal(state.baseCommit, base);
	assert.deepEqual(state.differences, [
		{ path: 'added.md', kind: 'deleted', matchesBefore: true },
		{ path: 'changed.md', kind: 'modified', matchesBefore: true },
		{ path: 'removed.md', kind: 'restored', matchesBefore: true },
		{ path: 'tab\tpost.md', kind: 'modified', matchesBefore: false },
		{ path: 'type.md', kind: 'type-changed', matchesBefore: false }
	]);
	assert.deepEqual(parsePublicationRemoteState(JSON.stringify(state)), state);
	for (const invalid of [null, '{}', 'invalid', JSON.stringify({ ...state, differences: [{ path: 'post.md', kind: 'unknown' }] })]) {
		assert.equal(parsePublicationRemoteState(invalid), null);
	}
	assert.deepEqual(readFileSync(join(root, '.git/index')), index);
	assert.equal(git('rev-parse', 'HEAD'), remote);
	assert.equal(git('status', '--porcelain'), before);
	console.log('publish-remote.check: ok');
} finally {
	rmSync(root, { recursive: true, force: true });
}
