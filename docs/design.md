# pi-sites — design & capability map

Status: authoritative design document for the pi-sites extension.
Sources: this repo's `README.md` (Sites field guide), the installed Sites
plugin bundle, the official Sites docs, and pi 0.83.0 extension docs.
Every claim below traces to one of those sources; unverifiable items are
marked `UNVERIFIED`.

Last verified: 2026-08-02
Bundle version verified against: **`0.1.33`** (`$HOME/.codex/plugins/cache/openai-bundled/sites/0.1.33/`)
pi version verified against: **`0.83.0`** (`npm view @earendil-works/pi-coding-agent version` → 0.83.0)

---

## 1. Product contract (from the field guide, bundle, and official docs)

ChatGPT Sites projects are Cloudflare Worker-compatible Vite/Vinext apps:

| Contract item | Facts | Source |
| --- | --- | --- |
| `package.json` + lockfile | reproducible Node graph; starter requires Node `>=22.13` | README; starter package.json |
| `vite.config.*` | Worker-compatible Vite/Vinext build; starter composes `vinext()` + `sites()` + `cloudflare()` with `compatibility_flags: ["nodejs_compat"]`; local D1/R2 bindings derived from hosting.json | starter vite.config.ts |
| `worker/` entry | server-side Cloudflare Worker-compatible fetch handler (`worker/index.ts` in starter) | README; starter |
| `.openai/hosting.json` | control-plane link; **only** `project_id` (string, added after provisioning) plus optional logical `d1`/`r2` bindings (`string` or `null`); never secrets, env values, or customer data | README; hosting SKILL; official dev guide; starter ships `{"d1":null,"r2":null}` |
| `.env.example` | documents required env names without committing secrets; local `.env` untracked; hosted values managed through Sites | README; building SKILL |
| migrations + `db/schema.*` | Drizzle/SQLite; migrations in `drizzle/`; must exist before packaging when schema changed | building SKILL; package-site.sh stages `dist/.openai/drizzle/**` |
| Build output | `dist/server/index.js` (required), static assets when emitted, `dist/.openai/hosting.json` (required), `dist/.openai/drizzle/**` when migrations exist | hosting SKILL; package-site.sh verified live |

Publishing lifecycle (official dev guide + hosting SKILL):

```
local source change → clean build → git commit → saved Site version
  → private deployment → access/domain check → public release (deliberate)
```

- **Save a version** = deployable snapshot associated with the Git commit used
  for the build (provenance). **Deploy** = promote a saved version; every
  deployment is a production deployment (no staging).
- **Private-first** is the default posture: `deploy_private_site_version`
  preferred; shared/public deploy only after explicit approval.
- **Source write credential**: obtained from `create_site` (or
  `create_source_repository_write_credential`); used as a per-command HTTP
  authorization header, never in remote URLs or Git configuration; the pushed
  branch-head SHA becomes `commit_sha`.
- Managed env values live in Sites settings; after changing hosted values a
  redeploy of the saved version is required (official gotcha).
- Identity headers: `oai-authenticated-user-id`, `oai-authenticated-user-email`,
  optional percent-encoded `oai-authenticated-user-full-name`; private Sites
  require sign-in. Authorization must be enforced server-side.
- Runtime: supported Sites runtime only — no long-running background jobs,
  arbitrary private-network access, or external DBs; plan-specific usage
  limits during beta.

### Script behavior (verified live 2026-08-02 in `/tmp` scratch dirs)

**`scripts/init-site.sh`** (root wrapper → `skills/sites-building/scripts/init-site.sh`):
- Args: `target` (default `$PWD`).
- Emptiness check: fails with **exit 2** and `Target is not empty: <dir>` on
  stderr when the target contains anything other than `.git`, `.DS_Store`,
  `work`, `outputs` (verified: exit 2 with a log file present).
- On success (**exit 0**, verified): copies `templates/vinext-starter/.` into
  target, `git init -b main` when no `.git`, then `npm ci
  --ignore-scripts --prefer-offline --no-audit --no-fund`.
- Generated layout (verified): `app/`, `build/`, `db/`, `drizzle/`,
  `worker/`, `.openai/hosting.json` (`{"d1":null,"r2":null}`), `package.json`
  + lockfile, `vite.config.ts`, `drizzle.config.ts`, `eslint.config.mjs`,
  `next.config.ts`, `postcss.config.mjs`, `tsconfig.json`, `public/`,
  `tests/`, `examples/d1/`, `README.md`, `.gitignore`.
- `npm run build` on the fresh starter succeeds (verified, exit 0).

**`scripts/package-site.sh`** (root wrapper → `skills/sites-hosting/scripts/package-site.sh`):
- Args: `project` (default `$PWD`), `archive` (**required**; usage error when
  missing).
- Validations: `dist/server/index.js` missing → **exit 2** `Missing
  dist/server/index.js` (verified); `.openai/hosting.json` missing → **exit 2**
  `Missing .openai/hosting.json` (verified).
- Stages `dist/` + hosting.json → `dist/.openai/hosting.json` + `drizzle/` →
  `dist/.openai/drizzle/` (when present) into a temp dir, creates
  `tar -czf` with `dist/` at the top level, verifies the two required entries
  exist in the archive, prints the archive path on stdout (verified: exit 0,
  archive contains `dist/server/index.js`, `dist/.openai/hosting.json`,
  `dist/.openai/drizzle/**` when `drizzle/` exists).

---

## 2. Connector availability (WS1 question — answered with evidence)

**Can the Sites control plane be driven from pi?**

Two findings, both evidenced:

1. **Official docs**: the developer guide states Sites has no standalone Codex
   CLI *management view* — use ChatGPT web or the desktop app to create, save,
   deploy, and manage; Codex CLI can still edit and test a local project.
   No public REST API or MCP server is documented anywhere official (searched;
   nothing authoritative found → the absence of an API is UNVERIFIED as an
   official statement, but no such API is documented).
2. **Live probe (2026-08-02)**: `codex` CLI `0.146.0` (Homebrew) is installed
   and logged in (`codex login status` → "Logged in using ChatGPT");
   `codex plugin list` shows `sites@openai-bundled` **installed, enabled,
   0.1.33**. `codex exec --sandbox read-only "<prompt>"` loads the Sites
   plugin and exposes the full connector: `sites:sites-building` and
   `sites:sites-hosting` skills, plus the connector function set under the
   `mcp__codex_apps__sites_` namespace: `create_site`,
   `create_source_repository_write_credential`, `save_site_version`,
   `deploy_private_site_version`, `deploy_site_version`,
   `get_deployment_status`, `get_site`, `get_site_version`, `list_sites`,
   `list_site_versions`, `get_environment_variables`,
   `update_environment_variables`, `update_site_access`,
   `update_site_metadata`, `add_custom_domain`, `list_custom_domains`,
   `remove_custom_domain`, `refresh_custom_domain_status`,
   `get_site_worker_logs`, `generate_siwc_bypass_token` (20 functions).

**Decision**: the `codex` CLI with the officially distributed Sites plugin is
an officially documented interface (the plugin is the official connector and
its own skill text is the documented usage contract). Driving the connector
through `codex exec` is therefore a **viable automation path from pi**, but
only as an explicit opt-in behind a config flag (`connector.command`), because:
- it requires the Codex CLI + plugin + ChatGPT login on the machine;
- the official docs still describe web/desktop as the primary management
  surface;
- automation must never call undocumented endpoints — we only delegate to
  `codex exec`, which uses the plugin's documented connector.

Default posture: **guided desk** (operator performs control-plane steps in
ChatGPT web/desktop, with exact locations). Optional automation: set
`connector.command` in `.pi/sites.json` (e.g. `["codex","exec","--sandbox",
"workspace-write"]`); the release desk then offers connector-backed steps via
`codex exec` with bounded prompts, never handling credentials itself.

---

## 3. Capability matrix (capability → surface → implementation → verification)

| # | Product capability | Surface | Implementation | Verification |
| --- | --- | --- | --- | --- |
| 1 | Scaffold a new Sites project (starter) | **script** | `sites_init` tool + `/sites init`: locate bundle, mirror emptiness guard, invoke `init-site.sh` into target; bounded output; degrade w/ hint when bundle absent | live invocation (this doc §1); unit test; integration test |
| 2 | Build validation | **script** | `sites_check` runs `npm run build` (bounded) | live; integration test |
| 3 | `hosting.json` shape validation | **script** | `sites_check` validates schema (project_id/d1/r2 only, secret-value rejection) | unit tests |
| 4 | `.env.example` parity + documented names | **script** | `sites_check` parses names, compares with local `.env` | unit tests |
| 5 | Secrets scan (tracked files) | **script** | `sites_check` scans `git ls-files` output against patterns; `.env` tracked flagged | unit test w/ staged fake token fixture |
| 6 | Worker entry + buildable `dist/server/index.js` | **script** | `sites_check` checks `worker/` + post-build artifact | unit + integration |
| 7 | Release checklist (README observability) | **script/guided** | `sites_check` emits one item per README checklist entry; automated vs `manual` status | unit tests |
| 8 | Package for deploy | **script** | `sites_package` tool + `/sites package`: invoke `package-site.sh`, verify archive entries + size | live (this doc §1); integration |
| 9 | Save version | **guided**, connector-optional | release desk step with exact web/desktop location; optional `codex exec` when `connector.command` set | unit test (state machine); live probe of codex exec (this doc §2) |
| 10 | Deploy private-first | **guided**, connector-optional | same; private deploy is the default step; public deploy requires explicit operator choice | unit test |
| 11 | Access/metadata/env values/domains | **guided**, connector-optional | guided steps (chatgpt.com/sites → More actions → Settings); optional codex exec | unit test; UNVERIFIED live (no real site) |
| 12 | Diagnosis (deployment status, worker logs) | **guided**, connector-optional | `/sites diagnose`: local facts (build state, hosting.json, release log, env parity); worker-log inspection guided via web; optional codex exec (`get_deployment_status`, `get_site_worker_logs`) | unit test; live `codex exec` tool listing (§2) |
| 13 | Release traceability | **pi session** | release log entries via `pi.appendEntry("sites-release", …)`; restored in `session_start` | unit test; live session |
| 14 | Runtime trigger | **pi event** | `before_agent_start` bounded guidance when `.openai/hosting.json` present; toggleable `.pi/sites.json` `promotion.enabled` (default true); no-op without bundle | unit test + live session |
| 15 | `/sites` menu TUI | **pi TUI** | select-loop menu (pi-seek pattern) with status + actions; headless degradation (print summary) | live session; unit test for status builder |
| 16 | Tool descriptions | **pi tools** | every tool carries a "use when" clause (via `description`/`promptGuidelines`) | code review |
| 17 | Footer status | **pi UI** | bounded `ctx.ui.setStatus` line while in a Sites project: bundle version + short project id; no secrets/full ids | live session |
| 18 | Docs + skill | **repo** | README extension-usage section; this design doc; **no shipped `sites` skill** — decision below | review |

### Skill decision (WS4 §6.2.4)

**No `sites` skill is shipped.** Rationale: the bundle's `sites-building` /
`sites-hosting` skills are the authoritative (proprietary) guidance and may
not be copied; our tool "use when" descriptions plus the README field guide
cover the operator-facing workflow; a self-authored skill would duplicate or
drift from the bundle and risk confusion. `resources_discover` contributes
nothing. If the bundle is absent we degrade with an install hint rather than
reimplementing its guidance as a skill.

---

## 4. Integration decisions

1. **Bundle discovery**: scan `$HOME/.codex/plugins/cache/openai-bundled/sites/*/`
   for the highest version with `scripts/init-site.sh` + `scripts/package-site.sh`;
   record the version. Env override `PI_SITES_BUNDLE` (path to a bundle root)
   for testing. Absent bundle → tools/commands degrade with a clear message
   (install path hint), never crash, never reimplement.
2. **Config**: `.pi/sites.json` (project-scoped, read directly with `node:fs`
   from `ctx.cwd` — pi has no config API; `CONFIG_DIR_NAME` used). Keys:
   - `promotion.enabled`: bool, default `true` — before_agent_start trigger +
     footer status master switch.
   - `connector.command`: string[] | null, default `null` — optional codex
     exec automation prefix (e.g. `["codex","exec","--sandbox","workspace-write"]`).
   - `bundle.path`: string | null, default `null` — explicit bundle override.
   Unknown keys tolerated; parse failures fall back to defaults with a note.
3. **Secrets discipline**: scan patterns are conservative (high-entropy
   prefixes + key formats); hits are masked in output; the scan is the only
   place file contents are read for secrets; nothing is ever written to
   config/logs/URLs. `.env` tracked in git is reported as a failure.
4. **Private-first**: release desk deploys privately by default; public
   release is a separate, explicitly chosen final step with a warning.
5. **Output discipline**: every tool returns bounded text + machine-readable
   `details` (`CheckResult`, `PackageResult`, etc.); no unbounded dumps;
   truncation helpers from pi's exported utilities.
6. **Standalone**: extension loads with `pi -ne -e ./src/index.ts`; no runtime
   deps beyond the scaffold's peer set (typebox, pi packages); `node --test`
   with Node 26 native type stripping for tests; relative imports use `.ts`
   extensions (erasable-only TS, `allowImportingTsExtensions`).
7. **Module layout** (contracts for implementation children):
   - `src/core/bundle.ts` — `findSitesBundle(): SitesBundle | null`
     (`{ version, path, initScript, packageScript }`).
   - `src/core/config.ts` — `loadSitesConfig(cwd): SitesConfig` (+ defaults).
   - `src/core/hosting.ts` — `isSitesProject(dir)`, `readHostingConfig(dir)`,
     `validateHostingConfig(raw)`.
   - `src/core/secrets.ts` — `SECRET_PATTERNS`, `scanText`, `scanTrackedFiles(dir)`,
     `maskSecret`.
   - `src/core/git.ts` — `getGitState(dir): { headSha, dirty, branch, hasRepo }`.
   - `src/core/validate.ts` — `runSitesCheck(dir, opts): CheckResult` with
     `CheckItem[]` (id/label/status/evidence; status ∈ pass|fail|skip|manual).
   - `src/core/init.ts` — `runSitesInit(targetDir, bundle): InitResult`.
   - `src/core/package.ts` — `runSitesPackage(projectDir, archivePath, bundle): PackageResult`.
   - `src/core/output.ts` — `boundText`, `formatBytes`.
   - `src/release.ts` — `planRelease(dir)` (dirty-tree refusal), release log
     entry builder, `runConnectorStep(...)` (codex exec, flag-gated).
   - `src/events.ts` — `registerSitesEvents(pi)` (before_agent_start trigger,
     footer status refresh).
   - `src/menu.ts` — `openSitesMenu(ctx, pi)` + `projectStatus(...)`.
   - `src/index.ts` — entry: registers tools (`sites_init`, `sites_check`,
     `sites_package`, `sites_diagnose`), commands (`/sites` family), events,
     menu wiring. (Root integration file.)
   - `tests/*.test.ts` — unit tests per module + `tests/integration.test.ts`
     (real temp project via bundle; **skips with a clear message when the
     bundle is absent**).
8. **Git discipline**: conventional commits; `npm run check` green after the
   last change; integration tests skip cleanly without the bundle.

## 5. Open items / UNVERIFIED

- Live control-plane operations (create site, save version, deploy) were not
  performed — they require a real Sites account and would publish artifacts.
  The connector surface is verified only as *discoverable* via `codex exec`
  (§2). Marked UNVERIFIED for live end-to-end connector operation.
- Worker-log inspection surface in the official docs: no public statement
  found (scout searched variants). The connector exposes
  `get_site_worker_logs` (observed via codex exec). Guided path remains
  web/desktop.
- Beta usage limits are plan-specific; docs state ChatGPT shows current
  limits. No numeric table recorded.
