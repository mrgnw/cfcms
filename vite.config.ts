import adapter from '@sveltejs/adapter-node';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
	const blog = resolve(env.BLOG_CONTENT_BASE_DIR ?? '../blog');
	const blogLib = resolve(blog, 'src/lib');
	const blogAlias = existsSync(blogLib) ? blogLib : resolve('src/blog-defaults');
	const allowedHosts = (env.ALLOWED_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean);
	const hmrClientPort = env.HMR_CLIENT_PORT ? Number(env.HMR_CLIENT_PORT) : undefined;

	return {
		plugins: [
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
					experimental: { async: true }
				},
				adapter: adapter(),
				alias: { $blog: blogAlias },
				experimental: { remoteFunctions: true },
				paths: env.ORIGIN ? { origin: env.ORIGIN } : {}
			})
		],
		server: {
			host: env.HOST ?? 'localhost',
			port: Number(env.PORT ?? 5273),
			strictPort: true,
			allowedHosts: ['localhost', '127.0.0.1', ...allowedHosts],
			hmr: hmrClientPort ? { clientPort: hmrClientPort, protocol: 'wss' } : undefined
		}
	};
});
