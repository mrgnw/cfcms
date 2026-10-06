// node --import ./scripts/check-hooks.ts <file>: lets plain node load src/lib/server modules
// by resolving the SvelteKit aliases they use and the extensionless relative imports.
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const libDirectory = new URL('../src/lib/', import.meta.url);
const privateEnvModule = 'data:text/javascript,export const env = process.env;';

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === '$env/dynamic/private') return { url: privateEnvModule, shortCircuit: true };
		if (specifier.startsWith('$lib/')) specifier = new URL(specifier.slice('$lib/'.length), libDirectory).href;

		const isPath = specifier.startsWith('.') || specifier.startsWith('file:');
		if (isPath && !/\.\w+$/.test(specifier)) {
			const candidate = new URL(`${specifier}.ts`, context.parentURL);
			if (existsSync(fileURLToPath(candidate))) specifier = candidate.href;
		}
		return nextResolve(specifier, context);
	}
});
