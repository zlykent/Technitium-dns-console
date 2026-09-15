<div align="center">

<img src="./public/logo.svg" alt="Technitium DNS Console" width="96" height="96" />

# Technitium DNS Console

**A modern bilingual (zh / en) web console for Technitium DNS Server**

[中文](./README.md) | [English](./README.en.md)

</div>

---

## Overview

This project is an independently developed **web console** for managing [Technitium DNS Server](https://technitium.com/dns/). It is _not_ the DNS server itself — it is a graphical management layer built on Next.js that talks to Technitium's HTTP API through a built-in proxy (currently aligned with **v15.4**, covering **129 endpoints**).

Compared with the bundled web UI, this console focuses on:

- **Bilingual (zh / en)**: every user-facing string is managed through `next-intl`; the Chinese and English key trees are kept in exact parity and can be switched at runtime.
- **A modern operator experience**: a dense, ops-oriented UI built on Radix UI + Tailwind CSS v4, with light / dark themes.
- **A defence-in-depth proxy**: all requests flow through a single catch-all proxy with SSRF protection, IP pinning (anti DNS-rebinding), httpOnly token cookies, an endpoint allowlist, and audit logging.
- **Multi-server management**: save several Technitium server profiles in the browser and switch between them; tokens are stored per origin.

> This project is not affiliated with Technitium Software. It is an independent community implementation.

## Features

Covers the main management scenarios of Technitium DNS Server:

| Module                            | Capabilities                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**                     | Query statistics, top domains / clients, chart visualisations                                                                                                 |
| **Zones**                         | Create / edit / delete zones, import / export / clone / convert, record management, zone options, zone ACL permissions, **DNSSEC** signing and key management |
| **DNS Client**                    | Run resolution tests against a chosen server (DNSSEC and EDNS Client Subnet supported)                                                                        |
| **Cache**                         | Inspect / delete / flush cached records                                                                                                                       |
| **Filtering (Allowed / Blocked)** | Manage allow / block lists, import / export, temporarily disable blocking                                                                                     |
| **Logs**                          | Paginated query, download and export of DNS query logs and system logs                                                                                        |
| **DHCP**                          | Scope and lease management                                                                                                                                    |
| **Apps**                          | Manage installed apps, install / update from the app store                                                                                                    |
| **Settings**                      | Global DNS / logging / web-service / block-list configuration, backup and restore                                                                             |
| **Admin**                         | Users, groups, permissions, sessions, cluster, SSO configuration                                                                                              |
| **Account**                       | Profile, change password, two-factor auth (2FA / TOTP), API tokens, my sessions                                                                               |

Navigation is gated by **permission sections**: menu visibility and route guards read the same declarative model (see [`lib/nav.ts`](./lib/nav.ts)), and after login the user lands on the first page they are actually allowed to open.

## Tech Stack

| Area                    | Choices                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| Framework               | Next.js 16 (App Router), React 19, TypeScript 5.9 (`strict`)                               |
| Styling                 | Tailwind CSS v4 (CSS-first, **no `tailwind.config.ts`**; tokens live in `app/globals.css`) |
| Components              | Radix UI Primitives + `class-variance-authority` + `cn`                                    |
| Data                    | TanStack Query v5 (server state), TanStack Table v8 (tables)                               |
| Forms                   | react-hook-form + zod                                                                      |
| i18n / theming          | next-intl, next-themes                                                                     |
| Icons / charts / toasts | lucide-react v1.45, recharts, sonner                                                       |
| Proxy transport         | undici (custom Dispatcher for IP pinning)                                                  |
| Testing                 | Vitest (unit / component, jsdom), Playwright (E2E), Testing Library                        |
| Package manager         | pnpm 11 (Node >= 20.9.0)                                                                   |

## Architecture

### Request proxy

The browser never talks to the Technitium server directly. Every upstream call goes through a single catch-all route, [`app/api/dns/[...path]/route.ts`](./app/api/dns/[...path]/route.ts), which is only a shim — the real logic lives in [`lib/proxy/kernel.ts`](./lib/proxy/kernel.ts), unit-testable in isolation:

```
GET|POST /api/dns/<endpoint>?<params>  →  <target>/api/<endpoint>?<params>
```

Proxy pipeline (10 steps):

1. Resolve the target from the `X-Dns-Target` header, else fall back to `TECHNITIUM_API_URL`;
2. **SSRF validation** + DNS resolution;
3. **Pin** the validated IP into the Dispatcher (anti DNS-rebinding);
4. Read the httpOnly token cookie for that server;
5. **Endpoint allowlist** + **HTTP-method allowlist** (registry-driven);
6. Forward the query string and body verbatim, injecting `Authorization: Bearer`;
7. Apply a timeout by response kind (JSON 30s / file 120s);
8. Translate Technitium's four `status` values into HTTP semantics;
9. Unwrap the response envelope (or stream a file download straight through);
10. Write one audit line.

### Security model

- **Tokens are never readable by scripts**: on successful login the session token is written to a per-origin httpOnly cookie, and the `token` field is stripped from login / session responses so it never reaches front-end JS.
- **SSRF protection** ([`lib/proxy/target.ts`](./lib/proxy/target.ts)): cloud metadata addresses (`169.254.169.254`, `fd00:ec2::254`), multicast / reserved / unspecified addresses are always blocked; loopback and link-local are additionally blocked for untrusted request-supplied targets; IPv4-mapped / NAT64 addresses are unwrapped before checking; **every** address a hostname resolves to must pass, and the final IP is pinned to prevent a poisoned second lookup.
- **Registry-driven allowlist**: the permitted endpoints, methods, auth requirements and envelope shapes are defined once in [`lib/api/registry.ts`](./lib/api/registry.ts), keeping the typed SDK and the proxy allowlist provably in step.
- **Security headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy` are injected globally (see [`next.config.ts`](./next.config.ts)).
- **Destructive actions are confirmed**: delete, flush, uninstall, revoke and restore always go through a confirm dialog.

### Project structure

```
app/
  (auth)/login/            unauthenticated page
  (console)/…              authenticated console pages (each route is a Server Component shim)
  api/dns/[...path]/       the single catch-all proxy route
  api/auth/token/          auth-related route
components/
  ui/                      shadcn-style primitives (one component per file)
  app/                     cross-page building blocks (data table, page shell, …)
  layout/                  sidebar, topbar, switchers — chrome only
  charts/                  recharts wrappers
  <module>/                per-module client views and dialogs
lib/
  api/                     proxy client + typed SDK (domains/ per area, types/, registry allowlist)
  proxy/                   proxy kernel (kernel / target / forward / envelope / cookies / audit / errors)
  auth/                    session context
  servers/                 multi-server profile store and provider
  format/                  pure presentation formatters (locale passed explicitly)
  hooks/                   client hooks
  i18n/                    next-intl configuration
messages/{zh,en}/          copy across 16 namespaces (zh/en key parity)
scripts/                   i18n checks, icon checks, API probe / generation, screenshots, …
tests/                     Vitest unit / component tests; E2E in the Playwright convention dir
docs/                      API endpoints, page patterns, UI conventions
```

## Getting Started

### Prerequisites

- **Node.js >= 20.9.0** and **pnpm 11** (`corepack enable` will provision it).
- A **reachable Technitium DNS Server instance** (default `http://127.0.0.1:5380`) and its admin account.

### Install and run

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment variables (edit the upstream address, etc.)
cp .env.example .env.local

# 3. Start the dev server (port 5390 by default)
pnpm dev
```

Open <http://localhost:5390> in your browser and sign in with your Technitium credentials.

> When no server is selected, the proxy falls back to `TECHNITIUM_API_URL`; you can also add / switch between multiple server profiles via the server switcher in the top-right corner (stored in the browser).

### Production build

```bash
pnpm build
pnpm start        # also listens on port 5390
```

## Environment Variables

Copy [`.env.example`](./.env.example) to `.env.local` and adjust as needed:

| Variable                                                         | Description                                                                                                                                                                                                                              | Default                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `TECHNITIUM_API_URL`                                             | Upstream DNS server address used when no server profile is selected                                                                                                                                                                      | `http://127.0.0.1:5380` |
| `TECHNITIUM_ALLOWED_TARGETS`                                     | Comma-separated target allowlist. **When set, only these `host:port` values may be proxied** and the permissive guard is disabled. Leave empty for permissive mode (loopback / link-local / cloud-metadata addresses are always blocked) | empty                   |
| `SESSION_COOKIE_PREFIX`                                          | Cookie name prefix; harden with a random value in production                                                                                                                                                                             | `tdns`                  |
| `PROXY_TIMEOUT_JSON_MS`                                          | JSON request timeout (ms)                                                                                                                                                                                                                | `30000`                 |
| `PROXY_TIMEOUT_FILE_MS`                                          | File download timeout (ms)                                                                                                                                                                                                               | `120000`                |
| `PROXY_AUDIT_LOG`                                                | When `true`, log one audit line for every proxied call                                                                                                                                                                                   | `true`                  |
| `E2E_BASE_URL` / `E2E_DNS_URL` / `E2E_DNS_USER` / `E2E_DNS_PASS` | Used **only** by the Playwright E2E suite; never read by the app. Env-var overrides; built-in defaults live in `tests/e2e/env.ts`                                                                                                        | built-in                |

## Scripts

| Command                                                | Purpose                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| `pnpm dev`                                             | Start the dev server (port 5390)                            |
| `pnpm build` / `pnpm start`                            | Production build / start                                    |
| `pnpm lint` / `pnpm lint:fix`                          | ESLint check / auto-fix                                     |
| `pnpm format`                                          | Prettier formatting                                         |
| `pnpm typecheck`                                       | TypeScript type check (`tsc --noEmit`)                      |
| `pnpm test` / `pnpm test:watch` / `pnpm test:coverage` | Run Vitest / watch mode / coverage                          |
| `pnpm e2e` / `pnpm e2e:ui`                             | Run Playwright E2E / UI mode                                |
| `pnpm i18n:check`                                      | Verify zh / en key-tree parity                              |
| `pnpm i18n:usage`                                      | Verify keys "used in code but missing from the bundle"      |
| `pnpm icons:check`                                     | Verify lucide v1.45 icon names                              |
| `pnpm audit:coverage` / `pnpm audit:params`            | API coverage / parameter audit                              |
| `pnpm verify`                                          | **Full verification gate** (see below)                      |
| `pnpm probe` / `pnpm probe:types`                      | Probe the API from a running server / generate a type draft |

## Testing & Verification Gate

A change is not considered done until `pnpm verify` passes, which runs in order:

```
i18n:check → i18n:usage → audit:coverage → audit:params → typecheck → lint → test → build
```

- **Unit / component tests**: Vitest + Testing Library, covering components, formatters, the proxy kernel and API domain functions.
- **End-to-end tests**: Playwright, pointed at a real server via `E2E_*` environment variables (built-in defaults live in `tests/e2e/env.ts`).
- See [`docs/ui-conventions.md`](./docs/ui-conventions.md) and [`docs/page-patterns.md`](./docs/page-patterns.md) for the detailed conventions.

## Internationalisation

- Copy lives in `messages/<locale>/<namespace>.json` across **16 namespaces**: `common`, `nav`, `auth`, `errors`, `dashboard`, `zones`, `records`, `dnssec`, `filtering`, `logs`, `dhcp`, `apps`, `dnsClient`, `settings`, `admin`, `account`.
- The `zh` and `en` key trees must be identical, enforced by `pnpm i18n:check`.
- **Never hard-code a user-facing string**: use `useTranslations('<namespace>')` on the client and `getTranslations` on the server. Add a new key to both locales in the same change.

## API Endpoint Registry

The Technitium API surface (endpoints, methods, auth, envelope shapes, parameters) is documented in [`docs/api-endpoints.md`](./docs/api-endpoints.md), auto-generated by `scripts/probe/` from a running server's console bundle. When endpoints change, re-probe with `pnpm probe`.

## Disclaimer

This project is an independent community implementation and is **not affiliated with or endorsed by Technitium Software**. Technitium DNS Server and its trademarks are the property of Technitium Software. Please assess security and compliance for your own use; the repository does not currently ship an open-source licence (`package.json` is marked `private`).
