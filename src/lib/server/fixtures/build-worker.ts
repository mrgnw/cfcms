import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

mkdirSync('src/lib/icons', { recursive: true });
writeFileSync('src/lib/icons/build.svg', '<svg/>');
if (process.env.CMS_CHECK_BUILD_MODE?.startsWith('wait')) {
	writeFileSync('build.started', '');
	const deadline = Date.now() + 15_000;
	while (!existsSync('build.release')) {
		if (Date.now() > deadline) throw new Error('Timed out waiting for build.release');
		await setTimeout(10);
	}
}
if (process.env.CMS_CHECK_BUILD_MODE?.endsWith('fail')) process.exitCode = 1;
