import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'cms-schedule-http-'));
const blog = join(root, 'blog');
const remote = join(root, 'remote.git');
const port = '15433';
const origin = `http://127.0.0.1:${port}`;
const git = (...args) => execFileSync('git', ['-C', blog, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
execFileSync('git', ['init', '-q', '-b', 'main', blog]);
execFileSync('git', ['init', '-q', '--bare', remote]);
git('config', 'user.name', 'CMS HTTP Test');
git('config', 'user.email', 'cms-http@example.test');
git('config', 'commit.gpgsign', 'false');
git('remote', 'add', 'origin', remote);
mkdirSync(join(blog, 'content'));
mkdirSync(join(blog, 'src/posts'), { recursive: true });
writeFileSync(join(blog, 'src/posts/live.svx'), '---\ntitle: Live\ndate: 2026-01-01\npublished: true\n---\n\nLive body.\n');
writeFileSync(join(blog, 'content/scheduled.md'), '---\ntitle: scheduled\ndate: 2026-01-01\npublish: true\n---\n\nScheduled body.\n');
git('add', '.');
git('commit', '-qm', 'HTTP schedule fixture');
git('push', '-qu', 'origin', 'main');

const startServer = async () => {
	const server = spawn(process.execPath, [fileURLToPath(new URL('../build/index.js', import.meta.url))], {
		cwd: root,
		env: {
			...process.env, BLOG_CMS_DB: join(root, 'cms.db'), BLOG_CONTENT_BASE_DIR: blog,
			BLOG_CMS_DEPLOY_STATE_FILE: join(root, 'deploy-state.json'), BLOG_BUILD_COMMAND: 'true',
			HOST: '0.0.0.0', PORT: port, PROTOCOL_HEADER: 'x-forwarded-proto'
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let output = '';
	server.stdout.on('data', (data) => { output = (output + data).slice(-8192); });
	server.stderr.on('data', (data) => { output = (output + data).slice(-8192); });
	for (let attempt = 0; attempt < 50 && !output.includes('Listening on'); attempt += 1) {
		if (server.exitCode !== null) throw new Error(output);
		await setTimeout(100);
	}
	assert.ok(output.includes('Listening on'), output);
	return server;
};

const stopServer = async (server, signal) => {
	if (server.exitCode !== null) return;
	const exited = once(server, 'exit');
	server.kill(signal);
	await exited;
};

const request = (path, init = {}) => fetch(origin + path, {
	...init,
	headers: { Accept: 'application/json', Origin: origin, 'x-forwarded-proto': 'http', ...init.headers },
	signal: AbortSignal.timeout(15_000)
});
const latestSchedule = async () => (await (await request('/api/publish/schedule')).json()).schedule;
const publishCommits = () => git('log', '--format=%s', 'main').split('\n').filter((subject) => subject === 'cms: publish').length;

let server = await startServer();
try {
	assert.equal((await request('/publish')).status, 200);
	const staged = await request('/publish?/stage', { method: 'POST', body: new URLSearchParams({ path: 'scheduled.md' }) });
	assert.equal(staged.status, 200, await staged.clone().text());
	const dueAt = new Date(Date.now() + 3_000).toISOString();
	const created = await request('/api/publish/schedule', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ dueAt, timeZone: 'America/New_York' })
	});
	assert.equal(created.status, 200, await created.clone().text());
	assert.equal((await created.json()).schedule.state, 'pending');
	assert.match(await (await request('/publish')).text(), /Scheduled for/);

	await stopServer(server, 'SIGKILL');
	await setTimeout(Math.max(0, Date.parse(dueAt) - Date.now()) + 1_000);
	assert.equal(publishCommits(), 0, 'nothing publishes while the CMS is offline');

	server = await startServer();
	let schedule = await latestSchedule();
	for (let attempt = 0; attempt < 100 && schedule.state !== 'published'; attempt += 1) {
		assert.notEqual(schedule.state, 'failed', schedule.error);
		await setTimeout(100);
		schedule = await latestSchedule();
	}
	assert.equal(schedule.state, 'published', JSON.stringify(schedule));
	assert.equal(schedule.pushed, true);
	assert.equal(publishCommits(), 1);
	execFileSync('git', ['-C', remote, 'merge-base', '--is-ancestor', schedule.commit, 'main']);
	assert.match(await (await request('/publish')).text(), /Scheduled publish pushed/);
	console.log('schedule HTTP: a schedule made before a SIGKILL restart published once on the restarted server');
} finally {
	await stopServer(server, 'SIGTERM');
	rmSync(root, { recursive: true, force: true });
}
