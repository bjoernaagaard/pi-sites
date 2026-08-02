# pi-sites — next iteration research (v0.2 roadmap)

Status: research deliverable for the next iteration of pi-sites.
Method: fresh official-docs research (web), live Codex CLI probes, and a gap
analysis against the current extension surface (HEAD `bd3e4d5`) and the
installed Sites plugin bundle (0.1.33). Every claim is traced; unverifiable
items are marked `UNVERIFIED` with the reason.

Last checked: 2026-08-02 · pi 0.83.0 · codex CLI 0.146.0 · Sites bundle 0.1.33

---

## 1. Evidence: current official documentation state

1. **Developer guide** (`learn.chatgpt.com/docs/sites`, mirrored for
   developers at `developers.openai.com/codex/sites` — `UNVERIFIED` direct
   fetch: pages intermittently 403/load-fail; content below comes from
   search-summary corroboration): Sites shipped in **public beta as part of
   the ChatGPT Work launch (2026-07-09)**, replacing the old Canvas
   side-panel flow — ChatGPT now creates, hosts, versions, and serves the
   result at a real URL. Availability first on Pro, Pro Lite, Enterprise,
   Edu; Plus/Business followed; not Free/Go; not EEA/Switzerland/UK at
   launch.
2. **Core contract unchanged** (matches the pi-sites field guide):
   `.openai/hosting.json` holds only `project_id` + logical `d1`/`r2`
   binding names; two-stage publish (Save version → Deploy version); every
   deployment URL is a production URL; managed env values/secrets in Site
   settings (never in prompts, files, or hosting.json); saved versions map
   to Git commits for local projects; D1 (SQLite) + R2 on Cloudflare
   Workers; identity via workspace headers + Sign in with ChatGPT; custom
   domains via DNS records (not in Enterprise at launch); unsupported:
   Node servers, external DBs, WebSockets, background/scheduled jobs; no
   data or inference residency at launch; prohibited: payment-card
   processing, PHI, children under 13, malware.
3. **New since the field guide was written**: **Analytics** (unique
   visitors, page views, trends; non-Enterprise) — surfaced in-product, not
   in the Help Center. `UNVERIFIED` exact location/format (no official
   article; in-product only).
4. **Help Center collection** (help.openai.com/en/collections/20001370)
   contains 5 articles: creating/managing Sites (incl. custom-domain setup
   steps: Settings → Add domain → DNS records → refresh status), managing
   Sites for a workspace (custom domains NOT available in Enterprise at
   launch), data-protection compliance, privacy-policy preparation,
   responsibilities. No analytics article.
5. **Automation surface unchanged**: the developer guide still states there
   is no standalone Sites CLI management view — create/save/deploy/manage
   happens in ChatGPT web/desktop, or through Codex with the Sites plugin.
   No public REST/MCP API for the control plane is documented anywhere
   official (`UNVERIFIED` as an official "no API" statement — absence of
   documentation only).
6. **Sites plugin versioning**: the plugin is proprietary and distributed
   only through OpenAI's plugin marketplace. `openai/openai` repo does not
   exist (404); `openai/plugins` is a curated examples collection that does
   not include Sites. **No public source for a newer version than the
   installed 0.1.33** (`UNVERIFIED` whether a newer bundle exists; the
   marketplace pin on this machine is 0.1.33).

## 2. Evidence: the Codex CLI experience (live probes, 2026-08-02)

`codex` CLI 0.146.0, logged in via ChatGPT, Sites plugin installed+enabled
(`codex plugin list` → `sites@openai-bundled 0.1.33`).

1. **Connector surface (re-verified, machine-readable)**: `codex exec
   --json` exposes the full connector to agent sessions under
   `mcp__codex_apps__sites_` — 20 functions:
   `add_custom_domain`, `create_site`,
   `create_source_repository_write_credential`, `deploy_private_site_version`,
   `deploy_site_version`, `generate_siwc_bypass_token`,
   `get_deployment_status`, `get_environment_variables`, `get_site`,
   `get_site_version`, `get_site_worker_logs`, `list_custom_domains`,
   `list_site_versions`, `list_sites`, `refresh_custom_domain_status`,
   `remove_custom_domain`, `save_site_version`,
   `update_environment_variables`, `update_site_access`,
   `update_site_metadata`.
   These are the documented connector functions of the official plugin —
   the only sanctioned automation path from a terminal.
2. **Automation ergonomics (new flags, not yet used by pi-sites)**:
   `codex exec --json` (event stream with `item.completed` + token usage —
   ideal for machine consumption), `--output-schema <FILE>` (structured
   final output), `-o/--output-last-message <FILE>`, `--ephemeral` (clean
   session), `--add-dir <DIR>`, `--profile`, `--skip-git-repo-check`,
   `-i/--image`, `-s/--sandbox`. Plus `codex exec resume [ID|--last]
   [PROMPT]` for continuing long-running work.
3. **MCP bridge is NOT available today**: `codex mcp-server` exposes only
   two generic tools (`codex`, `codex-reply` — run/continue a Codex
   session) — the connector functions are NOT exported over MCP. The
   `enable_mcp_apps` feature flag exists but is `under development`.
4. **Experimental surfaces**: `codex app-server` (daemon/proxy + TS/schema
   generation for the app-server protocol) and `codex remote-control`
   (start/stop/pair) — the machinery behind the ChatGPT desktop app.
   Potentially a future path to drive the desktop app's Sites UI from pi;
   experimental, no protocol stability.
5. **Cloud tasks**: `codex cloud exec --env <ENV_ID> <QUERY>` +
   status/list/apply/diff — experimental; could offload long deploy flows
   to Codex Cloud, but `UNVERIFIED` whether Cloud sessions load the Sites
   plugin connector.
6. **Feature flags relevant to Sites**: `apps` (stable — the connector
   mechanism), `in_app_browser` (stable — open_in_codex), `image_generation`
   (stable), `goals` (stable), `enable_mcp_apps` (under development).

## 3. Gap analysis: current pi-sites vs the full workflow

| # | Workflow step | pi-sites today | Next iteration |
| --- | --- | --- | --- |
| 1 | Scaffold starter | `sites_init` (bundle script) | keep |
| 2 | Build + local checklist | `sites_check` (build, hosting.json, env parity, secrets, worker, dist, README checklist) | add `npm test` item (the starter ships `tests/rendered-html.test.mjs` via `npm test`) |
| 3 | Package archive | `sites_package` (bundle script) | keep |
| 4 | Create/connect the managed Site | **gap**: status shows "no project_id"; nothing provisions it | `sites_provision` behind `connector.command`: `create_site` → persist `project_id` into `.openai/hosting.json` (the plugin's documented flow) |
| 5 | Save version | guided step + optional `codex exec` step | keep; structured result via `--json`/`--output-schema` |
| 6 | Deploy private | guided + optional connector step | **status polling**: after deploy, `get_deployment_status` until settled; capture deployed URL into the release log entry |
| 7 | Access / sharing | guided step (settings) | optional `update_site_access` + `list_available_access_groups`-style guided note; connector step |
| 8 | Managed env values | guided step only; local parity only | **control-plane env-name parity**: `get_environment_variables` (names only) vs `.env.example` — the docs' "works locally, fails when deployed" guard, now enforced |
| 9 | Custom domains | guided step | optional connector steps: add/refresh/remove + DNS-record display |
| 10 | Analytics | **gap** (new 2026 capability) | guided step: open the Site's analytics view after deploy; `UNVERIFIED` exact in-product location |
| 11 | Worker logs / diagnosis | local `sites_diagnose` + guided | keep; optional `get_site_worker_logs` connector step (already in desk) |
| 12 | Site overview | **gap** | `sites_overview` behind flag: `list_sites` / `get_site` / `list_site_versions` → bounded status of the managed side |
| 13 | Release traceability | `appendEntry` log (sha, archive, status) | extend entries with `deployedUrl`, `versionId`, `projectId`; add `/sites log` view |
| 14 | Preview / browser handoff | none (bundle skill uses `open_in_codex` + dev server) | `sites_preview` command: start `npm run dev`, print the Local URL, guidance to open it (pi-side; no browser tool) |
| 15 | Social card / imagegen / screenshots | out of scope (bundle/imagegen-owned) | record as bundle-owned, never reimplement |

## 4. Proposed v0.2 scope (prioritized)

**P1 — connector reliability & provisioning (flag-gated, `connector.command`):**
1. `sites_provision`: create the managed Site via `create_site` (codex exec),
   persist the returned `project_id` into `.openai/hosting.json`, record it.
   Acceptance: unit tests for the prompt/parse; live UNVERIFIED without a
   real site.
2. Structured connector runner: switch `runConnectorStep` to
   `codex exec --json` (+ `--ephemeral`), parse `item.completed`, bound
   output; optional `--output-schema` for deploy results.
3. Deploy-status step in the release desk: after a connector private
   deploy, poll `get_deployment_status` and write the deployed URL into the
   release log entry (`appendEntry`).
4. Control-plane env-name parity check in `sites_check` (behind flag):
   `get_environment_variables` names vs `.env.example` names; report
   missing/drifted names, never values.

**P2 — surface completion (no new dependencies):**
5. `npm test` item in `sites_check` (starter ships rendered-HTML tests;
   skip cleanly when the project has no test script).
6. `sites_preview` command: `npm run dev` + Local URL output.
7. Custom-domain connector steps (add/refresh/remove) in the release desk.
8. Analytics guided step (post-deploy checklist).

**P3 — evaluate later (recorded, not committed):**
9. Desktop-app automation via `codex app-server`/`remote-control`
   (experimental; `UNVERIFIED` protocol stability).
10. MCP bridge via `codex mcp-server` — **not viable today** (only
    `codex`/`codex-reply` tools); revisit when `enable_mcp_apps` matures.
11. Codex Cloud offload (`codex cloud exec`) — `UNVERIFIED` plugin/connector
    availability in Cloud sessions.

**Explicitly out of scope** (bundle-owned, proprietary): imagegen social
cards, in-app preview (`open_in_codex`), `public/screenshot.jpeg` capture,
anything that copies bundle skill content.

## 5. Open questions for the operator

- Should connector features stay strictly behind `connector.command`
  (default off), or get a per-feature opt-in (`connector.provision`,
  `connector.overview`)? Current design: one flag, default off.
- Is a real end-to-end connector verification acceptable on a throwaway
  Site (needed to move P1.1/P1.3 from unit-tested to live-verified)?
- Prioritize `sites_overview` (managed-side inventory) over analytics
  guidance?

## 6. Verification notes

- All codex CLI claims in §2 were produced by live probes on this machine
  (0.146.0): `--help` surfaces, `codex features list`, `codex mcp-server`
  tools/list probe (2 tools), `codex exec --json` connector enumeration
  (20 functions, `item.completed` payload captured to file).
- Web claims in §1 are search-corroborated; direct fetches of
  learn.chatgpt.com / developers.openai.com intermittently failed
  (403/load errors) — marked accordingly. Nothing in this document was
  fabricated; anything not directly observed is marked `UNVERIFIED`.
