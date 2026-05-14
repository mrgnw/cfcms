---
date: '2025-03-15'
description: LLMs are great at generating code. That's the problem.
pin: false
publish: true
tags:
- svelte
- ai
- llm
- opinion
title: Write less code, especially with LLMs
---

LLMs are great at generating code. That's the problem.

It's never been easier to produce mountains of boilerplate, sprawling abstractions, and verbose implementations. Copilot can fill your screen in seconds. Claude can scaffold an entire app in one prompt. But more code isn't better code.

Rich Harris made this case for Svelte years ago: [Write Less Code](https://svelte.dev/blog/write-less-code). Every line you write is a line you maintain, debug, and eventually refactor. The best code is the code you didn't write.

## LLMs amplify the problem

Ask an LLM to build a form handler and you'll get 80 lines of React with useState, useEffect, custom hooks, and error boundary patterns. Ask for the same thing in Svelte:

```svelte
<script>
	let name = $state('');
	let email = $state('');

	async function submit() {
		await fetch('/api/contact', {
			method: 'POST',
			body: JSON.stringify({ name, email })
		});
	}
</script>

<form onsubmit={submit}>
	<input bind:value={name} />
	<input bind:value={email} type="email" />
	<button>Send</button>
</form>
```

That's the whole thing. No state management library. No hooks. No wrapper components.

## De-generative code

We need less generative code and more **de-generative** code.

The best use of an LLM isn't "write me a component." It's:
- "Simplify this function"
- "Remove the unnecessary abstraction here"
- "What can I delete without breaking anything?"
- "Rewrite this in half the lines"

LLMs are good at compression too. Use them for it.

## The framework matters

This is why framework choice matters more than ever. A framework that requires less code per feature means LLMs produce less bloat, you maintain less surface area, and bugs have fewer places to hide.

Svelte's philosophy -- [write less code](https://youtu.be/BzX4aTRPzno?si=RRdnZc-j69y6zWRb&t=279) -- isn't just about developer experience. It's about the total cost of the software you ship.
