---
date: '2025-02-10'
description: '[Model Context Protocol (MCP)](https://modelcontextprotocol.io) lets
  Claude access local tools, files, and APIs. Instead of pasting context into chat,
  you give Claude direct access to what it needs.'
pin: false
publish: true
tags:
- ai
- claude
- mcp
- svelte
title: 'MCP: Connecting Claude to your dev tools'
---

[Model Context Protocol (MCP)](https://modelcontextprotocol.io) lets Claude access local tools, files, and APIs. Instead of pasting context into chat, you give Claude direct access to what it needs.

## Setup with Claude Code

Add servers to `~/.claude/mcp.json` (global) or `.mcp.json` (per-project):

```json
{
	"mcpServers": {
		"filesystem": {
			"command": "npx",
			"args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"]
		}
	}
}
```

## Svelte Development

The [Svelte MCP server](https://svelte-llm.khromov.se) gives Claude access to current Svelte 5 docs, migration guides, and API references -- so it writes modern Svelte instead of outdated Svelte 4 patterns.

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

## Useful MCP Servers

- **[filesystem](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem)** - Read/write files in allowed directories
- **[git](https://github.com/modelcontextprotocol/servers/tree/main/src/git)** - Git operations (log, diff, blame)
- **[sqlite](https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite)** - Query local databases
- **[brave-search](https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search)** - Web search from Claude
- **[postgres](https://github.com/modelcontextprotocol/servers/tree/main/src/postgres)** - Query Postgres databases

Full directory: [github.com/modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)

## Why this matters

Without MCP, you copy-paste code into Claude and hope it has enough context. With MCP, Claude reads your actual files, queries your actual database, and checks the actual docs. The answers are better because the context is real.
