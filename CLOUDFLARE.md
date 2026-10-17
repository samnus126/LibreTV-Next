# Cloudflare Workers deployment

This fork uses the OpenNext Cloudflare adapter. Deploy as a Worker, not a static Pages project.

## Workers Builds

Connect this GitHub repository with:

- Build command: `npm run build:cloudflare`
- Deploy command: `npm run deploy:cloudflare`
- Root directory: `/`
- Preview builds: disabled unless configured separately

Wrangler configuration is in `wrangler.jsonc`. Keep its Worker name aligned with the Cloudflare project name.

## Runtime secrets

Add `PASSWORD` as a runtime Secret in the Worker settings, then deploy the settings change. Without a password, the app intentionally refuses access. Do not put passwords in this repository or build commands.

Optionally add `PROXY_SECRET` as a separate runtime Secret; otherwise the existing application derives the signing key from `PASSWORD`.

`COOKIE_SECURE=true` is set for HTTPS deployments. Optional data source settings are documented in the main README. No data sources are bundled.

## Local checks

```sh
npm ci
npm test
npm run build:cloudflare
npm run preview:cloudflare
```

For local preview, add `PASSWORD` to the ignored `.dev.vars` file.

## Runtime differences

- DNS validation uses `resolve4` and `resolve6`, because Workers does not implement `dns.lookup`.
- Login throttling and application caches are per-instance in memory; they do not provide account-wide rate limiting. Configure Cloudflare rate limiting if shared enforcement is needed.
- Test actual upstream providers from the deployed Worker. Provider access restrictions and streaming behavior can differ by network location.
- Private LAN IPTV sources are not reachable from a public Worker by default.
