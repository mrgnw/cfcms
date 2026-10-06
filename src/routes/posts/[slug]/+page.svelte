<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PostEditor from '$lib/components/PostEditor.svelte';
	import { svxSlug } from '$lib/svx';

	let { data } = $props();

	// editing the slug field moves the post to a new URL; follow it instead of reloading into a 404
	function onSaved(frontmatter?: string) {
		const slug = frontmatter === undefined ? data.post.slug : svxSlug(data.post.path, frontmatter);
		if (slug === data.post.slug) return invalidateAll();
		return goto(resolve('/posts/[slug]', { slug }), { replaceState: true, invalidateAll: true });
	}
</script>

<svelte:head>
	<title>{data.post.title} · cms.xcc.es</title>
</svelte:head>

<a class="mobile-back" href={resolve('/')} aria-label="Back to post list">
	<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7">
		<path d="M10 3 5 8l5 5" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
	Posts
</a>
{#key data.post.path}
	<div class="post-enter">
		<PostEditor post={data.post} versions={data.versions} {onSaved} />
	</div>
{/key}

<style>
	.post-enter {
		animation: enter 180ms ease-out;
	}

	@keyframes enter {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	.mobile-back {
		display: none;
	}

	@media (max-width: 720px) {
		.mobile-back {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			background: var(--bg);
			border: 1px solid var(--line);
			border-radius: 999px;
			color: var(--ink-2);
			font-size: 13px;
			padding: 6px 12px 6px 10px;
			margin-bottom: 16px;
			text-decoration: none;
			width: fit-content;
		}
	}
</style>
