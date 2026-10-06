import adapter from '@sveltejs/adapter-node';
import { resolve } from 'node:path';

const blog = process.env.BLOG_CONTENT_BASE_DIR ?? '~/dev/blog';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter(),
		alias: { $blog: resolve(blog, 'src/lib') }
	}
};

export default config;
