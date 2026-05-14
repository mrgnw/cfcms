---
date: '2025-02-08'
description: Add Tailscale to any Docker Compose project as a sidecar container. Your
  app gets a stable hostname on your tailnet with automatic HTTPS -- no port forwarding,
  no reverse proxy config.
pin: false
publish: true
tags:
- docker
- tailscale
- selfhost
title: Tailscale as a Docker sidecar
---

Add Tailscale to any Docker Compose project as a sidecar container. Your app gets a stable hostname on your tailnet with automatic HTTPS -- no port forwarding, no reverse proxy config.

## 1. Add tailscale service to `compose.yml`

```diff
+ services:
+   tailscale:
+     image: tailscale/tailscale:latest
+     container_name: ${TS_HOSTNAME}-tailscale
+     restart: always
+     volumes:
+       - ./tailscale:/var/lib/tailscale:rw
+       - ./serve.json:/config/serve.json:ro
+     environment:
+       - TS_AUTHKEY=${TS_AUTHKEY}
+       - TS_HOSTNAME=${TS_HOSTNAME}
+       - TS_STATE_DIR=/var/lib/tailscale
+       - TS_SERVE_CONFIG=/config/serve.json
+     cap_add:
+       - net_admin
+       - sys_module

   your-app:
     image: whatever/app
+    network_mode: service:tailscale
+    depends_on:
+      - tailscale
```

`network_mode: service:tailscale` routes your app's traffic through the Tailscale container. Your app is now only accessible via your tailnet.

## 2. Create `serve.json`

```json
{
	"TCP": {
		"443": {
			"HTTPS": true
		}
	},
	"Web": {
		"HOSTNAME.YOUR_TAILNET_DOMAIN.ts.net:443": {
			"Handlers": {
				"/": {
					"Proxy": "http://127.0.0.1:PORT"
				}
			}
		}
	}
}
```

Replace `HOSTNAME`, `YOUR_TAILNET_DOMAIN`, and `PORT` with your values.

## 3. Add to `.env`

Get an auth key from [Tailscale admin](https://login.tailscale.com/admin/settings/keys) (reusable + ephemeral recommended):

```
TS_AUTHKEY=tskey-auth-xxxxx
TS_HOSTNAME=your-hostname
```

## 4. Update `.gitignore`

```
tailscale/
.env
```

## Updating all Tailscale containers

See running Tailscale containers:

```sh
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" | grep -E "(NAMES|tailscale)"
```

Pull latest and recreate all of them:

```sh
docker ps --format "{{.Names}}\t{{.Labels}}" | grep tailscale | \
  sed 's/.*com.docker.compose.project.working_dir=\([^,]*\).*/\1/' | sort -u | \
  xargs -I{} sh -c 'cd "{}" && docker compose up -d --pull always'
```
