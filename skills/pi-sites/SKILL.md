---
name: pi-sites
description: >-
  ChatGPT Sites workflow: scaffold, validate, package, diagnose, and connect
  Sites projects. Use when the user mentions ChatGPT Sites or asks to:
  scaffold a new Sites project in an empty directory (sites_init); run the
  release-readiness checklist before saving a version or deploying, or after
  any source change (sites_check); produce the deployment archive for a
  validated project (sites_package); investigate a broken or failing Site
  deployment (sites_diagnose); see what Sites exist or the managed state of
  a Site (sites_overview); or connect a local project to a managed Site
  (sites_provision). Connector-backed tools (sites_overview,
  sites_provision) activate only when connector.command is set in
  .pi/sites.json.
---

# pi-sites — ChatGPT Sites workflow

Sites projects are Worker-compatible Vite/Vinext apps linked to the managed
Sites control plane through `.openai/hosting.json`. Two surfaces:

- **Tools** — headless, safe in any context: `sites_init`, `sites_check`,
  `sites_package`, `sites_diagnose`, `sites_overview`, `sites_provision`.
- **Commands** — `/sites <subcommand>` (init, check, package, diagnose,
  release, status, log, edit, config, menu, help): the interactive release
  desk, TUI menu, and config editing. Tools and commands share the same core
  code; pick commands when the user is at the keyboard or wants the guided
  flow, tools when you act autonomously.

## Invocation

All six tool identifiers are snake_case and stable, so call them directly:

- `extensions.sites_init({ target? })`
- `extensions.sites_check({ path? })`
- `extensions.sites_package({ path?, archive? })`
- `extensions.sites_diagnose({})`
- `extensions.sites_overview({ path? })`
- `extensions.sites_provision({ path? })`

Each resolves to `{ content, text, details, isError }`; `details` carries the
machine-readable result (check items, package entries, connector output).
On an argument-shape error, `tools.describe({ ref: "extensions.<tool>" })`
and retry; if an identifier is not captured in the current provider set,
discover with `tools.search({ query: "sites" })` and call via
`tools.call({ ref, args })`.

## Shared preconditions

- **Bundle**: `sites_init` and `sites_package` need the Sites plugin bundle —
  discovered under `$HOME/.codex/plugins/cache/openai-bundled/sites/<version>`
  (highest version wins), overridable by `PI_SITES_BUNDLE` or `.pi/sites.json`
  `bundle.path`. When it is missing, those tools fail with an install hint.
  `sites_check` and `sites_diagnose` run without it — diagnose reports the
  bundle as missing.
- **Connector**: `sites_overview` and `sites_provision` run only when
  `.pi/sites.json` sets `connector.command` (e.g.
  `["codex","exec","--sandbox","workspace-write"]`). They are registered but
  inactive without it — the call fails with the disabled error. When the
  connector is off, guide control-plane work through ChatGPT web/desktop
  (chatgpt.com/sites) instead. Secrets are never echoed.
- **Config**: `.pi/sites.json` keys are `promotion.enabled` (default true,
  master switch for the before-agent-start Sites guidance and footer),
  `connector.command` (default null), `bundle.path` (default null). Edit
  headlessly with `/sites config get|set <key> [value]` or via `/sites edit`.
- **Ordering**: a release is a ladder — `sites_check` green, then
  `sites_package`, then save a version from an exact commit, then deploy
  **privately**, verify, and only then consider public access. The release
  desk enforces this; the tools do not.

## Branches

### Scaffold a new Sites project — `sites_init`

Use when the user wants to start a Sites project from the official starter.

- Requires the bundle. Input: `target` (optional, defaults to cwd). The
  target must be empty except `.git`, `.DS_Store`, `work`, `outputs` —
  anything else is refused (mirrors `init-site.sh` exit 2). Runs the starter
  copy plus `npm ci` (timeout 15 min).
- Interactive equivalent: `/sites init <dir>`.
- Completion: `ok: true` and the layout lists the generated entries. Then
  run `sites_check` — the scaffold is done only when its check comes back
  green on the fresh project.

### Validate release-readiness — `sites_check`

Use before saving a version or deploying, and after any source change.

- No bundle needed. Input: `path` (optional, defaults to cwd). Runs
  `npm run build` (timeout 10 min) and reports one item per check: build,
  hosting.json schema (only `project_id`/`d1`/`r2`), `.env.example` names,
  local `.env` parity, secrets scan of tracked files, `worker/` entry,
  `dist/server/index.js`, and the README release checklist (some items are
  `manual`). Never throws; each item is `pass|fail|skip|manual` with evidence.
- Interactive equivalent: `/sites check`.
- Completion: green means zero `fail` (`manual`/`skip` items do not block,
  but every `manual` item is a human check that must still happen). Resolve
  every `fail` before any control-plane step — green check is the release
  desk's local gate.

### Produce the deployment archive — `sites_package`

Use when a validated project needs the tar.gz to save a version.

- Requires the bundle. Inputs: `path` (optional, defaults to cwd), `archive`
  (optional, defaults to `<os tmpdir>/sites-package-<timestamp>.tar.gz`).
  Runs the bundle's `package-site.sh`, then verifies the archive contains
  `dist/server/index.js` and `dist/.openai/hosting.json`, plus
  `dist/.openai/drizzle/**` when the project has a `drizzle/` directory.
- Interactive equivalent: `/sites package`.
- Ordering: run `sites_check` first and resolve fails.
- Completion: `ok: true` with `errors` empty and `archivePath`/`sizeBytes`
  reported. Keep the archive path — save-a-version and the release desk
  consume it.

### Investigate a broken or failing deployment — `sites_diagnose`

Use when a Site is failing in production, a deploy is broken, or before
contacting support.

- No inputs, no bundle required (bundle shows as missing if absent). Reports
  local facts: git branch/sha/dirty state, hosting.json summary (project id
  prefix, d1/r2), bundle version, and release log; the command form also adds
  build-artifact presence and config lines (promotion, connector).
- Interactive equivalent: `/sites diagnose`.
- Completion: report every fact and name the one that is missing or
  mismatched (dirty tree, missing artifact, absent project_id, stale bundle).
  Pair with Worker-log inspection: `sites_overview` when the connector is
  enabled, otherwise the guided web console — the release desk's `logs` step
  covers both.

### Inspect the managed side of a Site — `sites_overview`

Use when the user asks what Sites exist, what is deployed, or wants the
managed state of the current project.

- Requires the connector (see preconditions); without it the tool is
  inactive — fall back to `/sites status` + `sites_diagnose` for local facts.
  Input: `path` (optional, defaults to cwd). Runs `codex exec` against the
  Sites plugin (`list_sites`, `get_site`, `list_site_versions`).
- Completion: report site title, project id, access level, deployment
  status, environment variable **names only**, custom domains, and the
  newest saved versions with commit shas.

### Connect a local project to a managed Site — `sites_provision`

Use when the project has no `project_id` yet and the user wants to create
the managed Site before saving a version.

- Requires the connector AND a Sites project: refuses when
  `.openai/hosting.json` is missing, and refuses when a `project_id` already
  exists (already provisioned — nothing to do). Input: `path` (optional,
  defaults to cwd). Runs `create_site` via `codex exec`, parses the returned
  id, and writes `project_id` into `.openai/hosting.json`, preserving d1/r2
  bindings.
- Completion: `ok: true` and the file now contains the new `project_id`
  (re-read it to confirm). Then re-run `sites_check` — the `hosting_json`
  item must pass before the release flow continues.

### Release desk — `/sites release`

Use when the user asks to release, save a version, or deploy a Site.

- Refuses a dirty working tree or a non-git directory: releases must come
  from an exact source commit. Runs `sites_check` and `sites_package` as
  local gates, then walks the control-plane steps: save version → deploy
  privately → verify access/env/domains → check logs. `public_release` is
  always manual — never automate it. Each step runs via the connector when
  enabled, otherwise with exact web/desktop locations.
- Appends a release-log entry (`planned`/`saved`/`deployed-private`) per step;
  `/sites log` shows the log, `/sites status` summarizes the project, and
  `/sites menu` opens the TUI. `/sites edit` changes config keys, hosting
  bindings, and release notes. With no subcommand and no UI, `/sites` prints
  help.
