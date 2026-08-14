# Deployment

This app ships as two Docker images — `api` (internal-only, never exposed to the host) and `nginx` (serves the built SPA and reverse-proxies `/api/` to `api`). The `nginx` container is the only thing that ever binds a host port, and it can run in one of three **TLS modes**:

- **`internal`** — this container terminates TLS itself via certbot (binds 80 + 443 directly).
- **`external`** — TLS is already terminated by a reverse proxy that exists on the host (system nginx, another app's proxy, etc.); this container only ever serves plain HTTP on one port.
- **`none`** — plain HTTP only, no TLS anywhere, no domain needed. For internal networks, testing, or a first deploy before you've decided how (or whether) to add TLS.

`internal` and `none` are self-contained. `external` also needs an existing reverse proxy on the host that already has a cert for your domain — this repo doesn't create or manage that proxy.

`pnpm run deploy` walks you through picking a mode, a domain (if applicable), and ports, then writes `.env` and runs `docker compose` for you. This doc covers what the *host* needs before that works, plus three full worked examples.

---

## What the box needs, start to finish

1. **Node.js 22.x** — Needed to run the deploy CLI Node script

2. **pnpm** — Needed to install the CLI's one dependency (`@inquirer/prompts`). Doesn't require a full monorepo dev setup.

   ```bash
   sudo npm install -g pnpm
   ```

3. **Docker Engine + the Compose plugin**

   ```bash
   docker compose version   # confirms both are present
   ```

4. **git** — to clone the repo onto the box.

5. **Firewall ports**, depending on TLS mode:
   - `internal` — open **80 and 443** (or whichever `HTTP_PORT`/`HTTPS_PORT` you choose) — port 80 is also needed for ACME HTTP-01 renewals.
   - `external` / `none` — open only the single `APP_PORT` you need (e.g. 8888). For `external`, 80/443 belong to the host's *own* reverse proxy, not this app.

6. **DNS** — only relevant for `internal` mode: the domain must already resolve to the box's IP before requesting a certificate. `external` and `none` don't need DNS to be pointed at this app at all (for `external`, DNS points at the host's existing proxy, which is presumably already set up).

7. **TLS material** — where it lives depends on mode:
   - **`internal` mode**: real certs must exist at `./nginx/letsencrypt/live/<domain>/{fullchain,privkey}.pem` before HTTPS will actually work. On a brand-new domain these don't exist yet — see the certbot bootstrap steps in Walkthrough B below.
   - **`external` mode**: the cert lives on the *host's* system nginx, entirely outside this repo. The deploy CLI only asks for its path so it can fill in the generated nginx snippet — it never touches or copies the cert itself.
   - **`none` mode**: nothing — there's no TLS anywhere in this setup.

---

## Walkthrough A — external nginx, external TLS, existing domain

The box already runs a system nginx that terminates TLS for `*.your-domain` with an existing cert. This app never touches TLS at all.

```bash
# On the box, once:
# Install pnpm
sudo npm install -g pnpm

# Clone the repo and install packages
git clone <repo-url> your-app-dir
cd your-app-dir
pnpm install

# Run the deploy script
pnpm run deploy
# TLS mode:  external
# Domain:    your-domain
# App port:  8888 (whatever's free)
# Cert path: /etc/letsencrypt/live/your-domain/fullchain.pem
# Key path:  /etc/letsencrypt/live/your-domain/privkey.pem
# → review screen → Continue
```

The CLI writes `deploy/generated/your-domain.conf` — an nginx `server {}` block matching the host's existing nginx style. Install it and reload:

```bash
sudo cp deploy/generated/your-domain.conf /etc/nginx/sites-available/
sudo nginx -t && sudo systemctl reload nginx
```

---

## Walkthrough B — brand-new plain server, no existing nginx, no domain yet, internal TLS

A fresh Ubuntu box with nothing on it, deploying to a domain that doesn't have a cert yet.

```bash
# 1. Prerequisites
# make sure node 22+ is installed
node -v # 22.x
sudo npm install -g pnpm
sudo usermod -aG docker $USER && newgrp docker   # so `docker` works without sudo

# 2. DNS — point your domain's A record at this box's IP before continuing.

# 3. Firewall
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 4. Clone + install the CLI's one dependency
git clone <repo-url> workforce-competency
cd workforce-competency
pnpm install

# 5. First boot WITHOUT a cert yet, just to serve the ACME challenge.
pnpm run deploy
# TLS mode: internal
# Domain:   yourdomain.example
# HTTP/HTTPS ports: 80 / 443
# → review screen → Continue
# (nginx will fail to bind :443 with no cert yet on the very first boot of a
#  brand-new domain — that's expected; :80 still comes up and serves
#  /.well-known/acme-challenge/, which is all certbot needs)

# 6. Issue the cert via the running :80 challenge endpoint (webroot mode):
docker run --rm \
  -v "$(pwd)/nginx/letsencrypt:/etc/letsencrypt" \
  -v "$(pwd)/nginx/certbot-www:/var/www/certbot" \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d yourdomain.example -d www.yourdomain.example

# 7. Restart nginx now that the cert exists:
docker compose -f docker-compose.yml -f docker-compose.internal-tls.yml restart nginx

# 8. Once you've confirmed HTTPS works end-to-end, flip the session cookie
#    to Secure (it defaults to true from the CLI, but if you set it to
#    false during the pre-cert bootstrap, change it back now):
pnpm run deploy   # re-run, edit SESSION_COOKIE_SECURE from the review screen
```

Certbot renewal: since port 80 stays bound to this app's nginx (which already serves `/.well-known/acme-challenge/`), a cron job running the same `certbot certonly --webroot ...` command periodically (e.g. via `crontab -e`) will renew in place without downtime.

---

## Walkthrough C — plain HTTP, no domain, no TLS at all

For an internal network deploy, quick evaluation, or any case where you genuinely don't want TLS in the picture yet.

```bash
sudo npm install -g pnpm
git clone <repo-url> your-app-dir
cd your-app-dir
pnpm install

pnpm run deploy
# TLS mode: none
# Domain:   (leave blank)
# App port: 8888
# CORS_ORIGINS: http://<this host's IP or hostname>:8888
# → review screen → Continue
```

The app is reachable at `http://<host>:8888` — nothing else to configure. `SESSION_COOKIE_SECURE` defaults to `false` in this mode since there's no HTTPS anywhere for the browser to require. When you're ready to add TLS later (either your own via certbot, or an existing proxy), just re-run `pnpm run deploy` and switch TLS mode.

---

## Troubleshooting

**Login succeeds (200) but every following request is `401 Unauthorised`, and the browser has no session cookie at all.**

This means `Set-Cookie` never reached the browser. Cause, in order of likelihood:

1. `SESSION_COOKIE_SECURE` is `true` (correct whenever there's HTTPS in front) but Express doesn't think the connection is secure — usually because an internal proxy hop is overwriting `X-Forwarded-Proto` with its own (incorrect) scheme instead of relaying the value set by the outer, TLS-terminating proxy. Check what the `nginx` container is actually forwarding:

   ```bash
   docker exec wca-nginx grep -A1 "X-Forwarded-Proto" /etc/nginx/conf.d/default.conf
   ```

   It should read `proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;` in `external` mode (relaying the host proxy's header) — **not** `$scheme` (which is always `http` for this internal-only hop). This exact bug shipped once and was fixed in `nginx/conf.d/templates/external-tls.conf.template`; if you're running an image built before that fix, rebuild.

2. Confirm directly against the API container, bypassing all proxies:

   ```bash
   curl -si -X POST http://localhost:<APP_PORT>/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"login":"admin","password":"<real password>"}'
   ```

   No `Set-Cookie` here is expected (that hop is always plain HTTP) — the real test is hitting the public HTTPS URL and checking for `Set-Cookie` there.

3. Check the container's actual environment matches what you expect:

   ```bash
   docker exec wca-api env | grep -E 'SESSION_COOKIE_SECURE|TRUST_PROXY|CORS_ORIGINS'
   docker logs wca-api --tail 50
   ```

**`docker compose ... up` fails immediately with `SESSION_SECRET is required`.** The CLI generates and writes one automatically — if you're running `docker compose` by hand instead of through `pnpm run deploy`, make sure `.env` exists and has `SESSION_SECRET` set.
