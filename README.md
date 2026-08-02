# ChatGPT Sites field guide

Portable notes for starting, maintaining, or handing over any [ChatGPT Site](https://learn.chatgpt.com/docs/sites). This guide describes the product contract rather than a particular app, repository, or deployment.

Last checked: 2026-08-02  
Installed Sites bundle when this guide was written: `0.1.33`  
pi-sites extension when this guide was written: `0.1.0` (built for pi `0.83.0`)

## Use these sources as the authority

| Resource | Use it for |
| --- | --- |
| [Sites developer guide](https://learn.chatgpt.com/docs/sites) | Architecture, project configuration, storage, environments, access, domains, and runtime limits. This is the primary technical reference. |
| [Creating and managing ChatGPT Sites](https://help.openai.com/en/articles/20001339-creating-and-managing-chatgpt-sites) | Product workflow and the ChatGPT web/desktop experience. |
| [ChatGPT Sites Help Center collection](https://help.openai.com/en/collections/20001370-chatgpt-sites) | The current set of product help articles and policy-oriented guidance. |

The Sites feature, its connector operations, and the bundled project templates can change. Re-read the developer guide before a new production launch; this document is an operational reference, not a frozen specification.

## The durable mental model

Keep two things separate:

1. **Your source repository** — ordinary code you can edit, test, commit, mirror, and hand to another developer.
2. **The Sites control plane** — the managed project, saved versions, deployment, access policy, custom domain, managed environment values, and optional D1/R2 resources.

That separation makes a project portable. A local clone can always be edited and built. Publishing to ChatGPT Sites requires access to the Sites control plane, but the source should never depend on the desktop app to remain usable.

## Compatibility contract for a new project

Retain these files and conventions in version control:

| Item | Why it matters |
| --- | --- |
| `package.json` and lockfile | Reproducible Node dependency graph. |
| `vite.config.*` | Build configuration; Sites projects use a Worker-compatible Vite/Vinext setup. |
| `worker/` entry point | The server-side Cloudflare Worker-compatible fetch handler. |
| `.openai/hosting.json` | Connects the local source tree to the managed Sites project and records logical D1/R2 bindings. |
| `.env.example` | Documents required local configuration without committing secrets. |
| migrations and `db/schema.*` (if using D1) | Makes persistent data rebuildable. |
| `README.md` | Documents local commands, required environment values, and release steps. |

Use a currently supported Node version (the current generated starter requires Node `>=22.13`). Keep the generated build adapter and Worker entry point unless you deliberately migrate the runtime and revalidate deployment.

`npm run build` is the minimum portability check. It should pass on a clean clone before a version is saved or deployed.

## A safe new-project sequence

When working in ChatGPT/Codex with the Sites bundle available:

1. Create an empty Git repository and give it a normal project-specific name.
2. Use the Sites project initializer supplied by the installed bundle, then inspect its generated `README.md`, `package.json`, Vite configuration, `worker/`, and `.openai/hosting.json`.
3. Implement the app, including title, description, social preview, error states, and responsive behavior.
4. Run `npm install` and `npm run build` locally. Use the project's `npm run dev` script for local browser testing.
5. Commit the source and lockfile. Do not commit `.env` files or generated credentials.
6. Create or connect the managed Site, save a version from an exact source commit, then deploy **privately** first.
7. Configure access, environment values, data resources, and a custom domain only after the private release works.

The exact initializer path is intentionally not hard-coded here: it is part of the installed Sites plugin and can move when the plugin updates. In this installation, inspect the newest local bundle under:

```text
$HOME/.codex/plugins/cache/openai-bundled/sites/<version>/
```

Its `scripts/`, `skills/sites-building/`, and `skills/sites-hosting/` directories describe the current starter and publishing flow.

## Local development without ChatGPT Desktop

You can write and test source code with normal local tooling:

```bash
npm install
npm run dev
npm run build
```

You do not need the desktop app for those tasks. For Sites-specific project management, use ChatGPT on the web at [chatgpt.com/sites](https://chatgpt.com/sites) when the desktop app is unavailable. There is no separate public Sites CLI or standalone public MCP server that replaces the managed Sites control plane.

If you have neither the desktop app nor access to ChatGPT web, you can still make ordinary source changes, run the build, commit them, and prepare a release. You will not be able to save a Sites version, change Site access/settings, or deploy to Sites until you regain control-plane access. Keep a private Git remote so the work is safe and independently transferable.

## Publishing lifecycle

Treat these as separate milestones:

```text
local source change
  -> clean build
  -> Git commit
  -> saved Site version
  -> private deployment
  -> access/domain check
  -> public release (only when intentional)
```

- **Save a version** creates a deployable snapshot associated with the managed Site.
- **Deploy** promotes a saved version. Every deployment is a production deployment for that Site.
- **Private first** is the default release posture. Public access is a deliberate policy change, not a test mode.
- Record the source commit SHA in the release notes or commit message so a deployed version remains traceable to source.

Do not place credentials, API tokens, or customer data in the saved source version. Store secrets as managed environment values; keep only variable names and safe examples in `.env.example`.

## Managed configuration: keep the boundary clean

### `.openai/hosting.json`

This small file is intentionally not a general settings store. It should contain only the managed `project_id` and logical D1/R2 resource bindings as provided by Sites. It must not contain API secrets, real customer identifiers, or copied production data.

### Environment values

- Put local values in an untracked `.env` file.
- Put names, harmless defaults, and explanations in tracked `.env.example`.
- Set production values through the managed Sites environment configuration.
- Keep local and hosted variable names identical to avoid a "works locally, fails when deployed" release.
- Rotate a value through the proper secret/environment manager; do not paste it into a commit, issue, or static client bundle.

### Access and identity

Private Sites can use ChatGPT/workspace-based sign-in and identity headers. Authorization must be enforced by server-side Worker code: browser-visible checks are useful for user experience but are not an access-control boundary. Confirm the intended workspace, sharing policy, and user behavior after every access change.

## Data design

| Need | Use | Do not rely on |
| --- | --- | --- |
| Structured, queryable persistent records | D1 | Browser storage or in-memory state. |
| Files, uploads, exports, images, or large immutable objects | R2 | D1 blobs or a browser cache as the system of record. |
| Per-browser UI preferences | Local storage is fine | Local storage for shared or critical data. |
| Authentication/authorization | Server-side Worker logic and supported identity headers | A hidden client-side route or a UI-only guard. |

For D1, include schema and migration files in the repository, use indexes that match real queries, and test upgrade paths from an empty database. When using both D1 and R2, D1 normally stores searchable metadata and object keys while R2 stores the blobs.

## Runtime and architecture limits

Sites are designed for web applications that fit the supported Worker/Vite runtime. Verify the latest limits in the developer guide before committing to an architecture. In particular, do not assume that these are available as in a conventional always-on server:

- long-running background jobs or a permanent polling daemon;
- arbitrary private-network access or a private database connection;
- any Node/server framework feature outside the supported runtime;
- regulated or highly sensitive data storage without an explicit product/security review.

For recurring polling, monitoring, queues, scheduled collectors, or always-on alerting, use an external worker/automation service that writes to the supported data layer or calls a carefully authenticated endpoint. Sites can be the dashboard and the control interface, but it should not be assumed to be the scheduler.

## Observability and release checklist

Before saving a release:

- [ ] `npm run build` passes from a clean install.
- [ ] A user without your local browser state can use the critical path.
- [ ] Empty, loading, error, and permission-denied states are understandable.
- [ ] Required environment names are documented in `.env.example`.
- [ ] No secret, token, database export, or private URL is staged for commit.
- [ ] Any database migration is included and has a rollback/recovery plan.
- [ ] The Worker enforces authorization for protected data/actions.
- [ ] The source commit SHA is known.

After private deployment:

- [ ] Confirm the expected Site version is live.
- [ ] Check server/Worker logs for errors on the key path.
- [ ] Test as an ordinary authorized user and, when appropriate, an unauthorized user.
- [ ] Confirm access level, environment values, and data bindings.
- [ ] Test the custom domain and sharing experience if either was changed.
- [ ] Promote to public only with an explicit decision.

## What an agent or an integration can do

In the ChatGPT environment, the managed Sites connector exposes operations in these groups:

| Area | Typical actions |
| --- | --- |
| Site lifecycle | Create a Site, inspect it, list versions, save a version, and deploy it. |
| Access and metadata | Change private/public access and title/metadata. |
| Runtime configuration | Read or update managed environment values. |
| Domains | Add, list, and verify custom domains. |
| Diagnosis | Inspect deployment status and Worker logs. |

Those are managed product capabilities, not a portable external API contract. Do not build automation that relies on an undocumented connector method name. Instead, keep the application source and its own integrations standard, with Site deployment as a controlled release step.

## Recovering or moving a project

1. Clone the repository and install dependencies from the lockfile.
2. Fill in local values from `.env.example` using the approved secret store.
3. Run the project locally and pass `npm run build`.
4. Recreate or connect the managed Site project and its access policy.
5. Recreate managed environment values and D1/R2 bindings; restore/migrate data only through approved procedures.
6. Save and deploy a private version, then validate before routing a domain or making the Site public.

A move to another hosting provider is a normal application migration: source code may move readily, but Sites-managed identity, deployment history, environment values, D1/R2 resources, domain settings, and access policies need their own explicit migration plan.

## Updating this guide

Before a new project or a significant upgrade, compare this guide with:

1. the [current developer guide](https://learn.chatgpt.com/docs/sites);
2. the [current Help Center collection](https://help.openai.com/en/collections/20001370-chatgpt-sites); and
3. the locally installed Sites plugin under `$HOME/.codex/plugins/cache/openai-bundled/sites/`.

If they disagree, the current official web documentation and the currently installed plugin instructions win. Update the guide with the date and bundle version after validating a material change.

## Using the pi-sites extension

`pi-sites` is a pi extension that wires this field guide into pi sessions: it
detects ChatGPT Sites projects, registers lifecycle tools, adds a `/sites`
command family with a release desk, and shows a compact Sites status line in
the pi footer. It never prints secrets or full project ids — only short,
bounded facts.

### Install

Two ways to load the extension:

- **npm** — `npm i pi-sites`, then enable the `pi-sites` extension in your pi
  configuration (package-managed extensions are listed with `pi config`).
- **from source** — run pi against the extension entry directly:

  ```bash
  pi -e ./src/index.ts
  ```

### Tools

| Tool | Use when |
| --- | --- |
| `sites_init` | Starting a new ChatGPT Sites project in an empty directory (scaffolds the bundle starter; refuses non-empty targets) |
| `sites_check` | Before saving a version or deploying, and after any source change — runs the release-readiness checklist (build, hosting.json schema, `.env.example` parity, secrets scan, worker entry, dist artifact, README checklist) |
| `sites_package` | Producing the deployment archive (tar.gz) for a validated project before saving a version (verifies `dist/server/index.js` and `dist/.openai/hosting.json` inside) |
| `sites_diagnose` | A deployment misbehaves — local build state, hosting.json, release log, and env parity, plus guided worker-log inspection |
| `sites_overview` | What Sites exist, what's deployed, or the managed state of the current project — appears automatically when `connector.command` is configured |
| `sites_provision` | The project has no `project_id` yet and needs to be connected to a managed Site (creates it via the connector, writes `project_id` into `.openai/hosting.json`) — appears automatically when `connector.command` is configured |

Connector-backed tools (`sites_overview`, `sites_provision`) are registered but kept
out of the active tool set unless `.pi/sites.json` sets `connector.command` — the
model only sees tools it can actually use.

### The `/sites` command family

`/sites` opens the Sites menu: **Status**, **Init**, **Check**, **Package**,
**Diagnose**, **Release desk**, **Edit settings**, and **Close**. Subcommands
(`/sites check`, `/sites package`, `/sites status`, `/sites log`, …) run a
single step directly; `/sites menu` reopens the interactive menu.
Release-log entries persist across sessions via `appendEntry` and render as
compact cards in the transcript (`/sites log` prints them as text).

### The edit menu — change or edit things

`/sites edit` (or **Edit settings** in the menu) opens a keyboard-driven TUI
menu built on the pi extension API (`ctx.ui.custom` + `SelectList`): a live
status pane on top, actions below (`↑↓` navigate, `enter` select, `esc`
cancel). From it you can change or edit:

- **config** — toggle `promotion.enabled`; set/clear `connector.command`;
  set/clear `bundle.path` (`.pi/sites.json`);
- **bindings** — set/clear the `d1`/`r2` logical bindings in
  `.openai/hosting.json` (validated: unknown keys and secret-like values are
  rejected, `project_id` preserved);
- **release log** — add a note to the latest release entry.

Every change refreshes the status pane; nothing is written without your
confirmation. Headless sessions get the same operations through
`/sites config get|set <key> [value]` (keys: `promotion.enabled`,
`connector.command`, `bundle.path`) instead of the menu.

The **release desk** walks the private-first release flow: record the exact
source commit → local validation green → deployment archive → save a Site
version → deploy privately → verify access/env/domains/logs → promote to
public only with an explicit decision. With `connector.command` configured,
control-plane steps can run through `codex exec` with the installed Sites
plugin — public release is never automated. Headless sessions print command
results to stdout (no TUI needed).

### `.pi/sites.json` configuration

Project-scoped config read from `<cwd>/.pi/sites.json`; a missing or
malformed file falls back to the defaults, and unknown keys are tolerated.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `promotion.enabled` | boolean | `true` | Master switch for the agent-start guidance trigger and the footer status line |
| `connector.command` | `string[]` or `null` | `null` | Optional `codex exec` prefix (e.g. `["codex","exec","--sandbox","workspace-write"]`) that enables connector-backed release desk steps |
| `bundle.path` | string or `null` | `null` | Explicit Sites plugin bundle root override (default: discover the newest installed bundle) |

### Workflow

```text
/sites init → /sites check → /sites package → Release desk → /sites diagnose
```

1. **Init** — scaffold a new project from the bundle starter into an empty
   target directory.
2. **Check** — run the release-readiness checklist; fix failures before
   continuing.
3. **Package** — produce the deployment archive from the validated build.
4. **Release desk** — record the source commit, save a Site version, deploy
   privately first, verify access/env/domains/logs, then promote to public
   only with an explicit decision.
5. **Diagnose** — when something misbehaves: build state, hosting.json,
   release log, and env parity, with guided worker-log inspection.

While a Sites project is open, the pi footer shows
`sites bundle <version> · proj <id-prefix>`; at agent start the session
receives a short guidance note (only when the bundle is installed and
`promotion.enabled` is on).
