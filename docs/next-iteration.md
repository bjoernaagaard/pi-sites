# pi-sites — v0.3 pass: how native can this be? (tools over docs)

Second final pass on the v0.2 suggestion, from the Pi extension API point of
view. Question asked: **how much of the roadmap can be native pi extension
mechanisms instead of documents, checklists, and guided steps?** Answer:
**nearly all of it.** Below is the native-viability matrix (evidence-backed),
the pi mechanisms verified live on pi 0.84.0, and the v0.3 tool-first build
list. This document is deliberately short — the tools are the product, not
this file.

---

## 1. Native-viability matrix (capability → pi mechanism → verdict)

Every row names the exact pi 0.84.0 API that makes the capability native.
"B" = bridge (must shell out to `codex exec` for the control plane — pi has
no direct connector); everything else is pure extension.

| v0.2 item | Pi-native mechanism | Verdict |
| --- | --- | --- |
| Release log traceability | `pi.appendEntry` + **`pi.registerEntryRenderer`** (transcript cards) + `/sites log` | ✅ **implemented** in this pass |
| Connector tools hidden until usable | **dynamic tools**: register always, `pi.setActiveTools` filter at `session_start`, activate when `connector.command` set | ✅ **implemented** (`sites_overview`, `sites_provision`); live-verified: model sees 4 tools without flag, 6 with |
| Create/connect managed Site (`create_site` → `project_id`) | `sites_provision` tool (B): `runConnectorStep` + `parseProjectId` + `withFileMutationQueue` write | ✅ **implemented**; live connector run UNVERIFIED (needs a real site) |
| Managed-side state (sites, versions, env names, domains) | `sites_overview` tool (B) with bounded output + machine-readable details | ✅ **implemented**; live run UNVERIFIED (needs a real site) |
| Save version | `sites_release`-desk connector step (B) — upgrade runner to `codex exec --json` + `--ephemeral`; parse `item.completed` | 📋 spec'd (runner exists; structured parsing next) |
| Deploy private + **status polling** | desk step (B) → poll `get_deployment_status`, capture `deployedUrl` into the release-log entry | 📋 spec'd; live UNVERIFIED |
| Env-name parity vs control plane | `sites_env_parity` tool (B): `get_environment_variables` names vs `.env.example` — names only | 📋 spec'd |
| Custom domains | `sites_domain` tool (B): add/refresh/remove + DNS records display | 📋 spec'd |
| Worker logs | `sites_logs` tool (B): `get_site_worker_logs` summary | 📋 spec'd (desk step exists today) |
| Local preview | `sites_preview` command: `npm run dev`, print Local URL (pure pi: `pi.exec`) | 📋 spec'd |
| Starter's own tests (`npm test`) | extra `sites_check` item (pure pi) | 📋 spec'd |
| Analytics (new 2026 capability) | guided step only — no pi data path; keep as one desk line, not a doc | 📋 minimal |
| Desktop-app automation | `codex app-server`/`remote-control` — experimental, protocol unstable | ⏸ park (UNVERIFIED) |
| MCP bridge | `codex mcp-server` exposes only `codex`/`codex-reply` — connector NOT exported | ⛔ not viable today (revisit `enable_mcp_apps`) |
| Field-guide/checklist docs | keep only README field guide; release checklist lives INSIDE `sites_check` (15 items with evidence) — not in a doc | ✅ already true |
| Skill file | none — tool `description` + `promptGuidelines` are the guidance | ✅ already true |

## 2. Pi mechanisms verified live this pass (pi 0.84.0, print/RPC modes)

| Mechanism | Evidence |
| --- | --- |
| `pi.getAllTools` / `pi.setActiveTools` (additive, filter at `session_start`) | probe extension: tool appears in `allTools`; activation set changes; then live: model-visible tool list = 4 sites_* tools (flag off) vs 6 (flag on) |
| `pi.appendEntry` → `ctx.sessionManager.getEntries()` round trip | probe + `/sites release` then `/sites log` in one RPC session: `1. planned 223c339 @ 2026-08-02T19:24:51.300Z [archive]` |
| `pi.registerFlag` / `pi.getFlag` | probe: default false, true when `--probe-flag` passed |
| `pi.registerEntryRenderer` / `pi.registerShortcut` | accepted at registration (TUI rendering itself headless-UNVERIFIED — RPC `custom()` returns undefined by design) |
| `codex exec --json` machine output | captured `item.completed` payload with the 20 `mcp__codex_apps__sites_` functions (0.146.0) |

## 3. v0.3 build list (tool-first; docs stay minimal)

Implemented in this pass (tests 60 → 69, gate green):
- `sites_overview`, `sites_provision` — connector tools, always registered,
  activated only with `connector.command` (dynamic-tools pattern).
- Release-log entry renderer (TUI transcript cards) + `/sites log` subcommand.
- `parseProjectId` + provision/overview connector prompts in `src/release.ts`.

Implemented in the TUI-menu pass (tests 69 → 83, gate green):
- **Edit menu** — `/sites edit` (and **Edit settings** in the menu): a
  keyboard-driven custom TUI component (`ctx.ui.custom` + pi-tui `SelectList`,
  docs Pattern 1) with a live status pane (config / hosting / release log) and
  11 actions to **change or edit things**: toggle `promotion.enabled`,
  set/clear `connector.command`, set/clear `bundle.path`, set/clear the `d1`/`r2`
  hosting bindings (validated, `project_id` preserved), add a release-log note.
  Component factory exported (`buildMenuComponent`) and unit-tested for
  render + keyboard (up/down/enter/escape); RPC/print degrade to the select
  loop / text summary; headless editing via `/sites config get|set <key> [value]`.
- `src/config-edit.ts` — shared, validated write path for config and
  bindings (withFileMutationQueue); `src/menu-tui.ts` — the reusable menu
  component and its `MenuUi` structural type.

Next build (each is a small, testable slice):
1. **Structured connector runner** — `codex exec --json` (+ `--ephemeral`),
   parse `item.completed` text; fall back to plain mode. Replaces raw-output
   handling in `runConnectorStep`.
2. **Deploy-polling step** — after a connector private deploy, poll
   `get_deployment_status`; write `deployedUrl` + `versionId` into the
   release-log entry; `/sites log` renders them.
3. **`sites_env_parity`** — control-plane env NAME parity vs `.env.example`
   (never values); integrates into `sites_check` as an extra item when the
   connector is active.
4. **`sites_domain`** — add/refresh/remove custom domains (B).
5. **`sites_preview`** — `npm run dev` + Local URL; `sites_check` gains the
   starter `npm test` item.
6. **Release desk → custom TUI component** (`ctx.ui.custom` step list with
   keys) replacing the select loop — headless fallback stays text.

## 4. Docs that stay / go

- Stay: README field guide (product contract) + this file (roadmap, lean).
- Go: nothing new — the v0.2 "guided steps" language is replaced by tool
  specs; `sites_check` already carries the release checklist as code.

## 5. Open questions

- Live connector verification on a throwaway real Site (P1.2/1.3) —
  acceptable?
- Should `sites_provision` require an explicit `--create` confirmation flag
  (it mutates the control plane)?
- Park `codex mcp-server` bridge until `enable_mcp_apps` matures — agreed?

## 6. Verification notes (TUI menu pass)

- The custom menu component render was captured live from a real pi TUI
  session (title, real config/hosting/release status lines, all 11 items with
  descriptions, help line). Component keyboard behavior (up/down/enter/escape
  → navigate/select/cancel) is covered by unit tests against the exported
  factory. RPC mode degrades to the select loop (verified live: 12-option
  dialog, Close exits); print mode returns the headless text summary
  (verified). `/sites config get|set` was verified live end-to-end (writes
  persisted to `.pi/sites.json` preserving unrelated keys).
- UNVERIFIED: full key-driven interaction in a REAL terminal. The pty
  environments available here (script, python pty) cannot cleanly deliver
  keys to custom components: the dumb pty echoes a terminal-query byte
  (`\x1b`) that pi routes to the focused component ~4s after open, which the
  SelectList correctly treats as cancel — an environment artifact that also
  affects pi's own custom-component examples, not an extension defect.
