---
date: '2025-03-09'
description: LLMs default to Svelte 4 patterns. If you don't give them context, you'll
  get `export let`, `$:` reactive statements, and `on:click` instead of Svelte 5 runes
  and modern syntax.
pin: false
publish: true
tags:
- ai
- claude
- llm
- svelte
- mcp
title: Configuring LLMs for Svelte 5
---

LLMs default to Svelte 4 patterns. If you don't give them context, you'll get `export let`, `$:` reactive statements, and `on:click` instead of Svelte 5 runes and modern syntax.

Here's how to fix that.

## Option 1: Svelte MCP server (best for Claude Code)

The [Svelte MCP server](https://svelte-llm.khromov.se) gives Claude direct access to current docs and the migration guide.

```json
{
	"mcpServers": {
		"svelte": {
			"command": "npx",
			"args": ["-y", "svelte-llm", "mcp"]
		}
	}
}
```

Add this to `~/.claude/mcp.json` (global) or `.mcp.json` (per-project).

## Option 2: Minimal context in a prompt file

If you can't use MCP, the [Svelte 4 to 5 migration guide](https://svelte-llm.khromov.se/svelte-migration) is the minimum context an LLM needs. It's more compact than the full docs at `svelte.dev/llms.txt`.

Drop it into whichever prompt file your editor uses:
- **Claude Code**: `CLAUDE.md` in your project root
- **Cursor**: `.cursor/rules/*.mdc`
- **VS Code Copilot**: `.github/copilot-instructions.md`
- **Windsurf**: `.windsurfrules`

## The key differences to enforce

The things LLMs get wrong most often:

| Svelte 4 (wrong) | Svelte 5 (correct) |
|---|---|
| `export let prop` | `let { prop } = $props()` |
| `$: derived = x * 2` | `let derived = $derived(x * 2)` |
| `on:click={handler}` | `onclick={handler}` |
| `<slot />` | `{@render children()}` |
| `import { writable } from 'svelte/store'` | `let value = $state(initial)` |

If you only put one thing in your prompt file, make it this table.
