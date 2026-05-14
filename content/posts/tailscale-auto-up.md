---
date: '2025-02-05'
description: Tailscale makes it easy to connect all my devices. (I have [too many](/gear)).
pin: false
publish: true
tags:
- tailscale
- vpn
title: Keep tailscale up on macOS with a LaunchAgent
---

Tailscale makes it easy to connect all my devices. (I have [too many](/gear)). 

Sometimes I intentionally disconnect tailscale temporarily. For example,
I [block bad traffic on all my devices](/secure%20your%20web%20traffic%20using%20dns-level%20blocking) using nextDNS.

If I'm controlling my mac remotely, that's not an option… unless I ensure that taiscale periodically reconnects.

Which I've done with this script:
It runs tailscale up every 30 minutes via LaunchAgent on macOS.

#### 1 • Create a script that ensures the tailscale app is running

```sh
mkdir -p ~/.scripts
cat << 'EOF' > ~/.scripts/tailscale-up
#!/bin/sh
open -a Tailscale
/Applications/Tailscale.app/Contents/MacOS/Tailscale up
EOF
chmod +x ~/.scripts/tailscale-up
```

Next, we'll create the LaunchAgent that runs this script automatically.

#### 2 • Create a LaunchAgent to run the script
```sh
UP_INTERVAL=1800
cat << EOF > "$HOME/Library/LaunchAgents/com.tailscale.up.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.tailscale.up</string>
    <key>ProgramArguments</key>
    <array>
        <string>${HOME}/.scripts/tailscale-up</string>
    </array>
    <key>StartInterval</key>
    <integer>${UP_INTERVAL}</integer>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
EOF
```

This looks ugly but I did it for *you* dear reader, because we [write better documentation](/write-better-docs) when we make them easy to use. Just copy+paste :)

On Linux, you might do this with systemd.
