import adapter from '@sveltejs/adapter-node';
import { resolve } from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const blog = process.env.BLOG_CONTENT_BASE_DIR ?? '~/dev/blog';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				experimental: { async: true }
			},
			adapter: adapter(),
			alias: { $blog: resolve(blog, 'src/lib') },
			experimental: { remoteFunctions: true },
			paths: { origin: 'https://cms.xcc.es' }
		})
	],
	server: {
		host: '0.0.0.0',
		port: 5273,
		strictPort: true,
		allowedHosts: ['.example.ts.net', 'localhost', '127.0.0.1', 'host.local', 'cms.xcc.es'],
		hmr: {
			clientPort: 443,
			protocol: 'wss'
		}
	}
});
