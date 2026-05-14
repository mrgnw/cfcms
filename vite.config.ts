import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
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
