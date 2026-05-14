<script>
  import config from '/src/config';
  import SEO from '$lib/SEO.svelte';
  import Post from '$lib/Post.svelte';
  import ArchiveSection from '$lib/ArchiveSection.svelte';
  import Icon from '@iconify/svelte';

  let { data } = $props();
</script>

<SEO
  title={`${config.siteTitle} — ${config.siteTagline}`}
  description={data.post?.description || config.siteTagline}
  og={{ title: config.siteTagline }}
/>

{#if data.post}
<div class="pt-24">  
  <Post post={data.post} mode="preview" />
</div>
{:else}
  <div class="flex flex-col items-center justify-center gap-8 py-16 text-center">
    <Icon icon="arcticons:emoji-building-construction" width="128" class="text-gray-400" />
    <h1 class="text-2xl font-light text-gray-600">Under Construction</h1>
  </div>
{/if}

<ArchiveSection 
  posts={data.posts.filter(post => !data.post || post.id !== data.post.id)} 
  limit={8} 
/>
