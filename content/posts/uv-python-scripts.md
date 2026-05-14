---
date: '2025-03-10'
description: 'Start your script with:'
pin: true
publish: true
tags:
- python
- uv
- unix
- dev
- scripts
title: make your python scripts run anywhere
---

### uv script shebang

Start your script with:

```py
#! /usr/bin/env -S uv run --script
```

### `uv install --script` 

Then [declare script dependencies](https://docs.astral.sh/uv/guides/scripts/#declaring-script-dependencies) with this:

```sh
script_filename=
script_packages=
uv add --script "$script_filename" "$script_packages"
```

```sh
# example
uv add --script standalone-script aiohttp rich
```

adds package dependies inside the file `standalone-script` like this:

```py
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "aiohttp",
#     "rich"
# ]
# ///
```

Inline script metadata was added in [PEP 723 – Inline script metadata](https://peps.python.org/pep-0723/)

## [Full example script on github](https://github.com/mrgnw/scripts/blob/main/gitllm#L2-L9)

[gitllm](https://github.com/mrgnw/scripts/blob/main/gitllm) is a script I threw together to grab relevant SvelteKit files from a github repo and dump them into a markdown file for feeding to LLM's like copilot's custom prompts.

## bonus reading

### What's the `-S` in the shebang? (split-string)

`man env` shows that `-S`:

> Split apart the given string into multiple strings, and process each of the resulting strings as separate arguments to the **env** utility.

Without `-S`, the env command tries to find a program literally named "uv run --script" rather than running `uv` with the arguments "`run`" and "`--script`".

```python
>> import subprocess
>> subprocess.run(['echo', 'yo'])
yo
>> subprocess.run('echo yo')
# ... (extra debugging details)
FileNotFoundError: [Errno 2] No such file or directory: 'echo yo'
```
