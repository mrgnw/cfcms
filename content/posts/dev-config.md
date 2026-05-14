---
date: '2025-02-05'
description: Scripts go in `~/.scripts`, which I add to my path.
pin: false
publish: true
tags:
- dev
- unix
- macos
title: my dev config
---

## [.zsh dotfiles](https://github.com/mrgnw/dotfiles)

Scripts go in `~/.scripts`, which I add to my path.

Some of my favorite parts

Jump to directory by searching history using zoxide

```sh
z () { z "$@" }
# also open in your default editor
ze () {z $1 && edit }
```

Quick docker-compose with automatic file detection

```sh
dc() {
    open -a "OrbStack"
    if [[ -f "$1" ]]; then
        docker-compose -f "$1" "${2:-up}" "${@:2}"
    elif [[ -d "$1" ]]; then
        docker-compose -f "$1/docker-compose.yml" "${2:-up}" "${@:2}"
    else
        docker-compose "${1:-up}" "$@"
    fi
}
```

Quick network tools

```sh
ip() { curl -sS ipinfo.io | jq '{ip:.ip, city:.city, country:.country}' }
# {
#   "ip": "147.209.170.11",
#   "city": "Townsville",
#   "country": "AU"
# }
port() { lsof -ti:$1 }
killport() { lsof -ti:$1 | xargs kill }

alias flushdns='dscacheutil -flushcache'
```

## global config files

[ruff](https://docs.astral.sh/ruff/) [configuration](https://docs.astral.sh/ruff/configuration/)

```
$HOME/.config/ruff/ruff.toml
```

```toml
line-length = 110

[format]
indent-style = "tab"
```

### [ghostty](https://ghostty.org/) terminal

`~/.config/ghostty/config` • [reference](https://ghostty.org/docs/config/reference)

```python
theme = dark:ChallengerDeep,light:GitHub-Light-Colorblind

font-family = SF Mono
font-size = 20

cursor-style = bar
cursor-color = #2aff9c
window-colorspace = display-p3
shell-integration-features = true

mouse-hide-while-typing = true
window-padding-balance = true

background-opacity = .85
background-blur = true

auto-update = download

# write_scrollback_file = open
keybind = "cmd+.=text:\x03"
```

### [lsd](https://github.com/lsd-rs/lsd)

~/.config/lsd/config.yml

```yaml
total-size: true
layout: oneline
sorting:
  dir-grouping: first
icons: { separator: '  ' }
blocks:
  - size
  - date
  - name
date: 'relative'
ignore-globs: ['.git']
hyperlink: auto
```
