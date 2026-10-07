<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PostEditor from '$lib/components/PostEditor.svelte';
	import { svxSlug } from '$lib/svx';
	import type { Post } from '$lib/types';

	let { data } = $props();

	// no row exists until the editor's first save creates it; then the same editor keeps going under the post's own URL
	let post = $state<Post>({
		path: '',
		title: '',
		slug: '',
		frontmatter: `title: ''\ndate: ${untrack(() => data.date)}\ntags: []\npublish: false`,
		body: ''
	});

	const moveTo = (slug: string, path: string) =>
		replaceState(resolve('/posts/[slug]', { slug }), { createdPath: path });

	function onCreated(created: { path: string; slug: string; id: string | null; contentHash: string }) {
		post = { ...post, path: created.path, slug: created.slug, id: created.id ?? undefined, contentHash: created.contentHash };
		moveTo(created.slug, created.path);
		invalidateAll();
	}

	function onSaved(frontmatter?: string) {
		if (!post.path) return;
		const slug = frontmatter === undefined ? post.slug : svxSlug(post.path, frontmatter);
		if (slug !== post.slug) {
			post = { ...post, slug };
			moveTo(slug, post.path);
		}
		return invalidateAll();
	}
</script>

<svelte:head>
	<title>New post · cms.xcc.es</title>
</svelte:head>

<a class="mobile-back" href={resolve('/')} aria-label="Back to post list">Posts</a>
<PostEditor {post} {onSaved} {onCreated} />

<style>
	.mobile-back {
		display: none;
	}

	@media (max-width: 720px) {
		.mobile-back {
			display: inline-flex;
			background: var(--bg);
			border: 1px solid var(--line);
			border-radius: 999px;
			color: var(--ink-2);
			font-size: 13px;
			padding: 6px 12px;
			margin-bottom: 16px;
			text-decoration: none;
			width: fit-content;
		}
	}
</style>
