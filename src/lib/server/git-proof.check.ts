import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'cms-git-proof-'));
const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
execFileSync('git', ['init', '-q', '-b', 'main', root]);
git('config', 'user.name', 'CMS Test');
git('config', 'user.email', 'cms-test@example.test');
git('config', 'commit.gpgsign', 'false');
const original = Array.from({ length: 30 }, (_, index) => `Paragraph ${index}`).join('\n') + '\n';
writeFileSync(join(root, 'post.txt'), original);
writeFileSync(join(root, '.gitattributes'), 'post.txt merge=union\n');
git('add', '.');
git('commit', '-qm', 'base content');
const base = git('rev-parse', 'HEAD');
git('checkout', '-qb', 'pending');
writeFileSync(join(root, 'post.txt'), original.replace('Paragraph 0\n', 'Approved opening\n'));
git('commit', '-qam', 'pending publication');
const pending = git('rev-parse', 'HEAD');
git('checkout', '-q', 'main');
writeFileSync(join(root, 'post.txt'), original.replace('Paragraph 29\n', 'A separate remote edit\n'));
git('commit', '-qam', 'remote advanced');
const remoteBeforeDelivery = git('rev-parse', 'HEAD');
git('cherry-pick', pending);
const rewrittenDelivered = git('rev-parse', 'HEAD');
process.env.BLOG_CONTENT_BASE_DIR = root;
process.env.BLOG_CMS_DB = join(root, 'cms.db');
const { withCheckoutLock } = await import('./checkout-lock.ts');
const { assertRecoveryGitVersion, verifyRewrittenCommit } = await import('./git-proof.ts');
const verify = (captured: string, remote: string) => withCheckoutLock(() => verifyRewrittenCommit(captured, remote));

try {
	for (const version of ['git version 2.43.0', 'git version 2.54.0 (Apple Git-157)', 'git version 3.0.0']) {
		assert.doesNotThrow(() => assertRecoveryGitVersion(version));
	}
	for (const version of ['git version 2.42.9', 'git version 2.40.0', 'git version 1.99.0', 'unrecognized']) {
		assert.throws(() => assertRecoveryGitVersion(version), /requires server Git 2.43.0 or newer/);
	}
	const index = readFileSync(join(root, '.git/index'));
	const body = readFileSync(join(root, 'post.txt'));
	assert.deepEqual(await verify(pending, rewrittenDelivered), { equivalent: true, paths: [] });
	assert.deepEqual(await verify(pending, remoteBeforeDelivery), { equivalent: false, paths: ['post.txt'] });
	assert.deepEqual(readFileSync(join(root, '.git/index')), index);
	assert.deepEqual(readFileSync(join(root, 'post.txt')), body);
	assert.equal(git('rev-parse', 'HEAD'), rewrittenDelivered);
	git('checkout', '-qb', 'divergent', base);
	writeFileSync(join(root, 'post.txt'), original.replace('Paragraph 0\n', 'A conflicting remote opening\n'));
	git('commit', '-qam', 'divergent remote');
	const divergent = git('rev-parse', 'HEAD');
	writeFileSync(join(root, '.git/info/attributes'), 'post.txt merge=accept-remote\n');
	git('config', 'merge.accept-remote.driver', 'touch driver-executed; true');
	assert.equal((await verify(pending, divergent)).equivalent, false);
	assert.ok(!existsSync(join(root, 'driver-executed')), 'recovery does not execute repository merge drivers');
	git('checkout', '-qb', 'deletion', base);
	writeFileSync(join(root, 'post.txt'), original.replace('Paragraph 0\n', ''));
	git('commit', '-qam', 'pending deletion');
	const deletion = git('rev-parse', 'HEAD');
	assert.equal((await verify(deletion, divergent)).equivalent, false,
		'a union merge attribute cannot accept a remote edit that conflicts with the queued deletion');
	assert.ok(!existsSync(join(root, 'driver-executed')));
	git('checkout', '-qb', 'queued-ancestors', base);
	writeFileSync(join(root, 'earlier-publication.txt'), 'Publication content from an earlier local commit.\n');
	git('add', 'earlier-publication.txt');
	git('commit', '-qm', 'earlier queued publication');
	const queuedAncestor = git('rev-parse', 'HEAD');
	writeFileSync(join(root, 'last-change.txt'), 'The final captured commit.\n');
	git('add', 'last-change.txt');
	git('commit', '-qm', 'last queued change');
	const queuedTip = git('rev-parse', 'HEAD');
	git('checkout', '-qb', 'partial-delivery', remoteBeforeDelivery);
	git('cherry-pick', queuedTip);
	const partialDelivery = git('rev-parse', 'HEAD');
	assert.deepEqual(await verify(queuedTip, partialDelivery), { equivalent: false, paths: ['earlier-publication.txt'] },
		'recovery cannot clear a publication whose final patch arrived without its queued ancestors');
	git('cherry-pick', queuedAncestor);
	assert.equal((await verify(queuedTip, git('rev-parse', 'HEAD'))).equivalent, true);
	const tree = git('rev-parse', `${base}^{tree}`);
	const left = git('commit-tree', tree, '-p', base, '-m', 'left base');
	const right = git('commit-tree', tree, '-p', base, '-m', 'right base');
	const leftMerge = git('commit-tree', tree, '-p', left, '-p', right, '-m', 'left merge');
	const rightMerge = git('commit-tree', tree, '-p', right, '-p', left, '-m', 'right merge');
	await assert.rejects(verify(leftMerge, rightMerge), /no unique common remote ancestor/);
	const unrelated = git('commit-tree', tree, '-m', 'unrelated root');
	await assert.rejects(verify(queuedTip, unrelated), /no unique common remote ancestor/);
	const actualGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
	const quotedGit = `'${actualGit.replaceAll("'", "'\\''")}'`;
	const oldGitBin = join(root, 'old-git-bin');
	mkdirSync(oldGitBin);
	writeFileSync(join(oldGitBin, 'git'), `#!/bin/sh\nif [ "$1" = "--version" ]; then\n\tprintf '%s\\n' 'git version 2.42.0'\nelse\n\texec ${quotedGit} "$@"\nfi\n`, { mode: 0o755 });
	const previousPath = process.env.PATH;
	process.env.PATH = `${oldGitBin}:${previousPath}`;
	try {
		await assert.rejects(verify(pending, rewrittenDelivered), /requires server Git 2.43.0 or newer/);
	} finally {
		if (previousPath === undefined) delete process.env.PATH;
		else process.env.PATH = previousPath;
	}
	console.log('git-proof.check: ok');
} finally {
	rmSync(root, { recursive: true, force: true });
}
