<script lang="ts">
	import { resolve } from '$app/paths';
	import DeployBadge from './DeployBadge.svelte';
	import { type PostCounts, type PostFilter, type PostListItem } from '$lib/types';

	let {
		recentPosts,
		counts,
		newTitle = $bindable(''),
		filter = $bindable('all')
	}: {
		recentPosts: PostListItem[];
		counts: PostCounts;
		newTitle?: string;
		filter?: PostFilter;
	} = $props();
</script>

<div class="home">
	<header class="home-head">
		<h2>Welcome back.</h2>
		<p>Pick up where you left off, or start something new.</p>
	</header>

	<form class="home-new" method="POST" action="?/create">
		<input name="title" bind:value={newTitle} placeholder="New post title…" autocomplete="off" />
		<button disabled={!newTitle.trim()}>Create post</button>
	</form>

	<div class="home-stats">
		<button type="button" class="stat" onclick={() => (filter = 'all')}>
			<em>{counts.all}</em><span>All</span>
		</button>
		<button type="button" class="stat" onclick={() => (filter = 'drafts')}>
			<em>{counts.drafts}</em><span>Drafts</span>
		</button>
		<button type="button" class="stat" onclick={() => (filter = 'ready')}>
			<em>{counts.ready}</em><span>Ready</span>
		</button>
		<button type="button" class="stat" onclick={() => (filter = 'live')}>
			<em>{counts.live}</em><span>Live</span>
		</button>
	</div>

	<section class="home-recent">
		<h3>Recent</h3>
		<div class="recent-grid">
			{#each recentPosts as item (item.path)}
				<a class="recent-card" href={resolve(`/?post=${encodeURIComponent(item.path)}`)}>
					<strong>{item.title}</strong>
					<span class="recent-meta">
						<DeployBadge post={item} />
						<span>{item.date || 'undated'}</span>
					</span>
					{#if item.tags?.length}<small>{item.tags.slice(0, 4).join(' · ')}</small>{/if}
				</a>
			{/each}
		</div>
	</section>
</div>

<style>
	.home {
		max-width: 760px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 28px;
		padding-top: 4vh;
	}

	.home-head h2 {
		font-family: var(--font-display);
		font-size: 34px;
		font-weight: 600;
		letter-spacing: -0.01em;
		margin: 0 0 6px;
	}

	.home-head p {
		margin: 0;
		color: var(--ink-3);
	}

	.home-new {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px;
	}

	.home-new input {
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 11px 14px;
		background: var(--bg);
		font: inherit;
		min-width: 0;
	}

	.home-new input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.home-new button {
		background: var(--accent);
		border: none;
		border-radius: 10px;
		color: var(--on-accent);
		cursor: pointer;
		font: inherit;
		font-weight: 600;
		padding: 0 16px;
	}

	.home-new button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.home-stats {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 10px;
	}

	.stat {
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 12px;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font: inherit;
		padding: 14px 16px;
		text-align: left;
	}

	.stat:hover {
		background: var(--hover);
	}

	.stat em {
		font-family: var(--font-display);
		font-size: 26px;
		font-style: normal;
		font-weight: 600;
		line-height: 1;
	}

	.stat span {
		color: var(--ink-3);
		font-size: 12px;
	}

	.home-recent h3 {
		color: var(--ink-3);
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.06em;
		margin: 0 0 12px;
		text-transform: uppercase;
	}

	.recent-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}

	.recent-card {
		border: 1px solid var(--line);
		border-radius: 12px;
		color: inherit;
		display: grid;
		gap: 5px;
		padding: 12px 14px;
		text-decoration: none;
	}

	.recent-card:hover {
		background: var(--hover);
	}

	.recent-card strong {
		font-size: 14px;
		line-height: 1.3;
	}

	.recent-meta {
		align-items: center;
		color: var(--ink-3);
		display: flex;
		font-size: 11px;
		gap: 6px;
	}

	.recent-card small {
		color: var(--ink-3);
		font-size: 11px;
	}

	@media (max-width: 720px) {
		.home-stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.recent-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
