---
date: '2025-01-07'
description: 'Run your SvelteKit app in Docker with secure Tailscale access. Template:
  [github.com/mrgnw/svelte-docker-tailscale](https://github.com/mrgnw/svelte-docker-tailscale)'
pin: false
publish: true
tags:
- docker
- svelte
- tailscale
- dev
title: Run your Svelte sites on Docker with Tailscale
---

# Running SvelteKit with Docker and Tailscale

Run your SvelteKit app in Docker with secure Tailscale access. Template: [github.com/mrgnw/svelte-docker-tailscale](https://github.com/mrgnw/svelte-docker-tailscale)


## Why?

- an easy URL
- URL never changes
  - no fighting for port 5173
  - works better with password managers
- easy access from any device, anywhere
- still works with hot module reloads (HMR)

## Add to an existing project

Instructions from [github.com/mrgnw/svelte-docker-tailscale](https://github.com/mrgnw/svelte-docker-tailscale)

Requires tailscale CLI installed & authenticated

```sh
# Get template files
TAILNET=$(tailscale status --json | jq -r '.MagicDNSSuffix')
TEMPLATE="https://raw.githubusercontent.com/mrgnw/svelte-docker-tailscale/main"
curl -O "$TEMPLATE/Dockerfile" & \
curl -O "$TEMPLATE/compose.yml" & \
curl -O "$TEMPLATE/tailscale_serve.json" & wait

# Set up Tailscale config
echo "\n/tailscale" >> .gitignore
echo "\ntailscale_serve.json" >> .gitignore

# Update serve.json with your domain
DOMAIN="${PWD##*/}.$TAILNET"
sed -i '' "s/localhost/$DOMAIN/" tailscale_serve.json
```

Get an auth key from [Tailscale admin console](https://login.tailscale.com/admin/settings/keys)

These are the only two required variables

```sh
TS_AUTHKEY=
TS_PORT=4177 # this needs to be unique for each container
```

If you did the above in your terminal, you can add them to your .env with this:

```sh
echo "TS_AUTHKEY=$TS_AUTHKEY" >> .env
echo "TS_PORT=$TS_PORT" >> .env
```

```sh
docker compose up
```

That's it! Your app will be available at `https://${PWD##*/}.$TAILNET`

## Create a new project

Create a project with [sv create](https://svelte.dev/docs/cli/sv-create) and then add the docker compose afterwards.
