---
date: '2025-02-05'
description: '[UV](https://github.com/astral-sh/uv) replaced pip, virtualenv, pipenv,
  poetry, and pyenv. One tool. Installs in seconds. Runs everything faster.'
pin: false
publish: true
tags:
- dev
- unix
- python
- macos
title: UV replaced my entire Python toolchain
---

[UV](https://github.com/astral-sh/uv) replaced pip, virtualenv, pipenv, poetry, and pyenv. One tool. Installs in seconds. Runs everything faster.

## Install

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## Beyond Python Projects

UV isn't just for managing Python projects. `uvx` runs any Python CLI tool without installing it globally -- replacing things you'd normally install with brew or pipx.

```sh
uvx marimo          # reactive notebooks
uvx harlequin       # SQL IDE in your terminal
uvx ruff check .    # lint Python
uvx yt-dlp URL      # download video
uvx llm "question"  # CLI access to LLMs
```

Install tools permanently with `uv tool add`:

```sh
uv tool add marimo
uv tool upgrade --all
```

## Project Management

```sh
uv init myproject
uv add fastapi pydantic
uv run python main.py
```

No `python -m venv`, no `pip install`, no `requirements.txt`. UV creates the venv, resolves dependencies, and locks them automatically.

## Self-Contained Scripts

UV also makes Python scripts fully portable with inline dependency metadata ([PEP 723](https://peps.python.org/pep-0723/)):

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx"]
# ///

import httpx
print(httpx.get("https://httpbin.org/ip").json())
```

Make it executable and it runs anywhere UV is installed. No venv, no setup. See [runnable python scripts](/runnable-py-scripts) for more.

## Why UV Over Traditional Tools

**Speed**: 10-100x faster than pip for dependency resolution.
**Reliability**: Deterministic installs with automatic lock files.
**Simplicity**: One tool for venvs, packages, scripts, and CLI tools.

It replaces pip, virtualenv, pipenv, poetry, and pyenv -- combined.
