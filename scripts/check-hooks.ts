// node --import ./scripts/check-hooks.ts <file>: lets plain node load src/lib/server modules
// by resolving the SvelteKit aliases they use and the extensionless relative imports.
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const libDirectory = new URL('../src/lib/', import.meta.url);
const privateEnvModule =
	'data:text/javascript,' +
	'export const BLOG_CMS_DB=process.env.BLOG_CMS_DB;' +
	'export const BLOG_CMS_DEPLOY_STATE_FILE=process.env.BLOG_CMS_DEPLOY_STATE_FILE;' +
	'export const BLOG_CONTENT_BASE_DIR=process.env.BLOG_CONTENT_BASE_DIR;' +
	'export const BLOG_BUILD_COMMAND=process.env.BLOG_BUILD_COMMAND;';

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === '$app/env/private') return { url: privateEnvModule, shortCircuit: true };
		if (specifier.startsWith('#lib/')) specifier = new URL(specifier.slice('#lib/'.length), libDirectory).href;
		if (specifier.endsWith('.js') && specifier.startsWith('file:')) {
			const candidate = new URL(`${specifier.slice(0, -3)}.ts`);
			if (existsSync(fileURLToPath(candidate))) specifier = candidate.href;
		}

		const isPath = specifier.startsWith('.') || specifier.startsWith('file:');
		if (isPath && !/\.\w+$/.test(specifier)) {
			const candidate = new URL(`${specifier}.ts`, context.parentURL);
			if (existsSync(fileURLToPath(candidate))) specifier = candidate.href;
		}
		return nextResolve(specifier, context);
	}
});
