# GOAL — pi-sites: a Pi extension for the ChatGPT Sites workflow

Read this document **fully, in order, before any action**. It is the single
authoritative specification for this goal. The `/goal` prompt points here;
when the prompt and this document disagree, this document wins.

---

## 0. Identity and session context

You are the maintainer of **pi-sites**, a Pi extension at
`/Users/bsa/Development/pi/pi-sites`. It exists as a verified scaffold
(commit `a67aa15`: ultracite/Biome toolchain with universal `AGENTS.md`,
`package.json` with the `pi.extensions` manifest, `tsconfig.json`,
`src/index.ts` stub). This goal develops the extension.

**pi-sites assists building, validating, and releasing websites built the
ChatGPT/OpenAI way — ChatGPT Sites.** Sites projects are Cloudflare
Worker-compatible Vite/Vinext apps with a `worker/` entry point, a
`.openai/hosting.json` control-plane link, optional D1/R2 resources, saved
versions, private-first deployments, custom domains, and managed environment
values. The source repo stays portable; the Sites control plane is managed by
OpenAI (ChatGPT web/desktop, or the Codex Sites plugin).

**Read first, in this order:**

1. `README.md` in this repo — the ChatGPT Sites field guide (product
   contract, compatibility contract, publishing lifecycle, data design,
   runtime limits, release checklist). It is an operational reference; the
   official docs and the installed plugin win on disagreement.
2. The installed Sites plugin bundle (read-only reference, proprietary —
   see §2.4):
   `$HOME/.codex/plugins/cache/openai-bundled/sites/<version>/` —
   `skills/sites-building/SKILL.md`, `skills/sites-hosting/SKILL.md`,
   `scripts/init-site.sh`, `skills/sites-hosting/scripts/package-site.sh`,
   `skills/sites-building/references/*`, `templates/vinext-starter/`,
   `.app.json`. At goal start the installed version is `0.1.33`.
3. The official sources: `https://learn.chatgpt.com/docs/sites` (developer
   guide), `https://help.openai.com/en/articles/20001339-creating-and-managing-chatgpt-sites`,
   and the ChatGPT Sites Help Center collection.
4. Pi's extension documentation (installed pi 0.83.0, the newest release —
   verify with `npm view @earendil-works/pi-coding-agent version`):
   `docs/extensions.md`, `docs/tui.md`, `docs/skills.md`,
   `docs/environment-variables.md`, and the `examples/extensions/` in the pi
   package. Use the newest APIs (tools, commands, shortcuts, `input` events,
   `before_agent_start`, resources/skill paths, custom UI, session
   persistence, custom rendering).

Out of scope: the other repos in `/Users/bsa/Development/pi` (pi-ast-grep,
pi-chimera, pi-codemode, pi-seek, pi-subagents) — do not touch them. The
workspace-root `GOAL.md` is a different goal; ignore it.

### Session and tools

This session is launched with the multi-agent extension (spawn_agent,
send_message, followup_task, wait_agent, interrupt_agent, list_agents,
list_models, get_agent_report, chimera_stats), pi-codemode (eval/wait),
pi-seek (ds_*), and pi-ast-grep (ast_grep_*) loaded. Use them all; report
immediately if any is missing. The operator is away; this document is your
decision authority.

### Model mandate (NON-NEGOTIABLE, operator standing rule)

- Root and EVERY spawned child = `deepseek-responses/deepseek-v4-flash` with
  reasoning `max`. Pass `reasoning_effort: "max"` explicitly; after every
  spawn verify the effective reasoning and override/respawn if clamped
  lower. No cross-provider children.

---

## 1. Mission overview

Build pi-sites into an extension that assists the whole ChatGPT Sites
workflow, from empty directory to deployed private site:

| # | Workstream | Outcome |
| --- | --- | --- |
| 1 | **Research & capability map** | The product contract (README + plugin bundle + official docs) is mapped to an extension surface; integration decisions recorded in `docs/design.md`. |
| 2 | **Local lifecycle tools** | Tools/commands that init, build-validate, preflight, and package Sites projects using the locally invocable plugin scripts — with graceful degradation. |
| 3 | **Control-plane & release workflow** | Save-version/deploy guidance and automation where a viable connector path exists; a release desk command; strict connector discipline. |
| 4 | **Promotion & DX** | The extension triggers where it is useful (`.openai/hosting.json` present), has a `/sites` TUI, docs, and strong tool descriptions. |

---

## 2. Execution policy (NON-NEGOTIABLE)

### 2.1 Multi-agent discipline

Plan work as parallel workstreams and delegate. Do not work single-threaded.

- Spawn **scout** children for research (read-only) with narrow, explicit
  questions (bundle inventory, official-docs extraction, pi-API surface).
- Spawn **implementation** children per workstream with narrow,
  non-overlapping ownership: exact files, requirements, verification.
- Children are leaf workers. You (root) integrate every diff, run every
  gate, keep all approval decisions.
- Coordinate with `send_message`, `followup_task`, `wait_agent`,
  `interrupt_agent`, `list_agents`; page reports with `get_agent_report`.

**HARD GATE:** not complete unless you spawned **at least 3 children**,
exercised **at least 4 of the 9 multi-agent tools**, and documented the full
agent tree (task, role, model, effective reasoning, outcome) in the final
report.

### 2.2 Research and analysis discipline

- Use `eval` cells for multi-step batches (file inventories, parallel reads,
  greps). Never chain single tool calls when one cell can do the step.
- Use `ds_web_search` for official-docs and product facts; record sources.
- Use `ast_grep_outline` before reading unfamiliar files and
  `ast_grep_run`/`ast_grep_scan` for structural questions. Record at least
  one outline + one structural search per workstream in the final report.

### 2.3 Repo discipline

- Gate: `npm run check` (ultracite + typecheck + package dry-run) must pass
  after the last change. Conventional commits (`feat:`, `fix:`, `docs:`,
  `test:`, `chore:`, `refactor:`), one logical change per commit.
- Do not modify the other repos in the workspace.
- Do not add runtime dependencies outside the scaffold's existing set
  (peer deps + dev deps) unless a workstream authorizes it with recorded
  rationale.
- The extension must stay standalone (`pi -ne -e ./src/index.ts`).
- Keep `AGENTS.md` current with the repo rules (keep the Ultracite
  section).

### 2.4 The plugin bundle is proprietary — treat it as reference + invoked binary, never as source

The Sites plugin (`openai-bundled/sites`) is **Proprietary** licensed:

- NEVER copy its code, skills text, templates, or assets into pi-sites.
- The extension may **invoke** its scripts (`init-site.sh`,
  `package-site.sh`) when present, and may **cite** its skill guidance.
- If a feature needs the bundle and it is absent, degrade gracefully with a
  clear message (install path hint), never a crash, never an invented
  reimplementation.
- Record which bundle version the extension was verified against
  (`0.1.33` at goal start) and re-verify before finalizing.

### 2.5 Connector discipline (the managed control plane)

- The Sites connector (`.app.json` connector id) is a **managed product
  capability of ChatGPT/Codex, not a public API**. Do NOT build automation
  that relies on undocumented connector method names or endpoints.
- Secret handling: per-command source-write credentials must never end up in
  remote URLs, Git configuration, commits, or `.env`; only variable names
  and safe examples go in `.env.example`. Managed values live in Sites.
- Private-first is the default release posture. Public access is a
  deliberate policy change.

### 2.6 Evidence and honesty (NON-NEGOTIABLE)

- Every claim in the final report must be backed by command output or tool
  results you actually ran. No fabricated verification.
- A gate that fails is not a reason to soften the gate. Fix the code.
- Anything not verifiable (no bundle, no connector, no credentials) is
  marked `UNVERIFIED` with the exact reason.

### 2.7 Goal completion rules

- Work in coherent slices; after each slice run the gate and record it.
- Mark complete only when **all four workstreams** meet their acceptance
  criteria and the final report exists. No early completion.
- Blocked only for a true impasse after the same blocker recurs for three
  consecutive goal turns. Missing bundle/connector/keys are NOT impasses —
  degrade and document.

---

## 3. Workstream 1 — Research & capability map

### 3.1 Objective

Produce a documented, verified map from the ChatGPT Sites product contract
to the pi-sites extension surface, so every later workstream builds on
facts, not assumptions.

### 3.2 Tasks

1. **Read (scout).** The repo README (field guide), the plugin bundle
   (skills, scripts, references, templates, `.app.json`, `plugin.json`),
   and the official docs (developer guide + help articles). Extract: the
   project compatibility contract, the publishing lifecycle, connector
   operation groups, runtime limits, data design rules, and the exact
   behavior of `init-site.sh` and `package-site.sh` (arguments, exit codes,
   validation performed).
2. **Pi API surface (scout).** From the installed pi 0.83.0 package: the
   extension APIs relevant to this extension — tools, commands, shortcuts,
   `input`/`before_agent_start` events, resources (skill/prompt paths),
   custom UI (`ctx.ui` + `custom()`), session persistence (`appendEntry`),
   footer status, renderers. Note the newest features and how sibling
   extensions in this workspace use them (pi-seek's `/deepseek` menu is the
   in-workspace TUI pattern).
3. **Integration surface analysis.** For each product capability decide:
   **script** (locally invocable), **connector** (managed, only via
   ChatGPT/Codex environment), **guided** (checklist/instructions in pi,
   operator performs the control-plane step), or **out of scope** (no
   viable path). Include the connector-availability question: can the
   control plane be driven from pi at all (ChatGPT web guidance, desktop
   app, or a `codex` CLI invocation when the plugin is installed)? Record
   findings — do not guess.
4. **Write `docs/design.md`.** The capability matrix (capability →
   surface → implementation plan → verification), the bundle-version
   record, connector findings, and every decision with rationale. Update
   `README.md` only if the field guide itself needs a correction (with
   evidence).

### 3.3 Acceptance criteria

- [ ] `docs/design.md` exists with the full capability matrix and
      integration decisions; every claim traces to the README, the bundle,
      or official docs.
- [ ] `init-site.sh` and `package-site.sh` behavior documented from the
      installed bundle (arguments, exit codes, side effects) and verified
      by at least one live invocation in a scratch directory.
- [ ] Connector-availability question answered with evidence
      (UNVERIFIED is acceptable with the reason).
- [ ] Bundle version recorded; `npm run check` passes.

---

## 4. Workstream 2 — Local lifecycle tools

### 4.1 Objective

Tools and commands that cover the fully local part of the Sites lifecycle:
project init → build → validation → packaging. Everything the operator can
do without the control plane.

### 4.2 Tasks

1. **Project init tool** (`sites_init` or similar): invokes the plugin's
   `init-site.sh` into a target directory with the same emptiness checks
   (never a second initializer, never overwrite a non-empty target).
   Bounded output; clear error when the bundle is missing (hint the
   install path, no crash). Document the generated layout
   (`package.json`, `vite.config.*`, `worker/`, `.openai/hosting.json`,
   `.env.example`, migrations, README).
2. **Validation/preflight tool** (`sites_check` or similar): runs against a
   Sites project and reports, per item, pass/fail with evidence:
   - `npm run build` succeeds from the current source;
   - `.openai/hosting.json` exists and contains only `project_id` plus
     optional logical `d1`/`r2` bindings (validate shape, reject secrets);
   - `.env.example` exists and required names are documented;
   - no staged secrets/tokens/private URLs (scan tracked files);
   - `worker/` entry point present; `dist/server/index.js` buildable;
   - the release checklist from the README (observability section).
   Use bounded output and a machine-readable result shape.
3. **Package tool** (`sites_package` or similar): invokes
   `package-site.sh PROJECT_DIR ARCHIVE_PATH`, verifies the archive
   (`dist/server/index.js`, `dist/.openai/hosting.json`, drizzle when
   present), reports the archive path and size.
4. **Commands + TUI.** `/sites` command family: at minimum
   `/sites init`, `/sites check`, `/sites package`, plus a
   `/sites` menu (pi-tui) showing the current project's state (hosting.json
   summary, build status, last check). Commands must degrade gracefully
   headless (print/JSON).
5. **Tests + docs.** Unit tests (validators, hosting.json schema, secrets
   scan, output bounds) and integration tests that run against a real
   temp project — integration tests **skip with a clear message when the
   bundle is absent** (mirror the ast-grep integration pattern). README
   and TECHNICAL-style docs updated.

### 4.3 Acceptance criteria

- [ ] Init/check/package tools work end-to-end against the installed
      bundle (recorded live output), degrade gracefully without it.
- [ ] Preflight covers every release-checklist item with pass/fail +
      evidence.
- [ ] Secrets scan catches a staged fake token in a test fixture.
- [ ] `/sites` command family + TUI work in a live session; headless
      degrades.
- [ ] `npm run check` green; integration tests skip cleanly without the
      bundle.

---

## 5. Workstream 3 — Control-plane & release workflow

### 5.1 Objective

Make the save-version → private-deploy → access/domain → public-release
lifecycle as smooth as the product allows, with strict connector
discipline. Where no automation path exists, provide a guided release desk
that never blocks on the control plane being absent.

### 5.2 Tasks

1. **Release desk command** (`/sites release` or a menu action): walks the
   publishing lifecycle as a checklist with local automation where
   possible:
   - exact source commit (record SHA; refuse to release a dirty tree);
   - `sites_check` green + `sites_package` archive produced;
   - control-plane steps (create/save version/deploy/env/domains/logs)
     presented as guided steps with the exact ChatGPT web/desktop location
     or connector call, private-first;
   - a release log entry persisted via `appendEntry` (SHA, archive, time,
     notes) so releases stay traceable;
   - never place credentials or customer data in the saved version.
2. **Automation investigation (WS1 follow-up).** If WS1 found a viable
   connector path from pi (e.g., a `codex` CLI with the Sites plugin
   installed, or any officially documented interface), implement it behind
   a config flag (`connector.command` or similar), with the per-command
   credential rules from §2.5. If the only viable paths are ChatGPT web/
   desktop, ship the guided desk only and say so in the report.
3. **Diagnosis support.** A command to gather local diagnosis facts
   (build state, hosting.json, release log, env-name parity) for pairing
   with Worker logs inspection.
4. **Tests + docs.** Unit tests for the release desk logic (dirty-tree
   refusal, log persistence, checklist state machine); docs for the
   release workflow.

### 5.3 Acceptance criteria

- [ ] `/sites release` guides the full lifecycle private-first, refuses a
      dirty tree, persists a release log, and never fabricates connector
      steps.
- [ ] The automation decision is recorded with evidence
      (implemented behind a flag, or explicitly out of scope with reason).
- [ ] No undocumented connector method or endpoint is used anywhere.
- [ ] Secrets never appear in test fixtures, logs, or docs.
- [ ] `npm run check` green.

---

## 6. Workstream 4 — Promotion & DX

### 6.1 Objective

The extension gets used where it is useful: models trigger it when a Sites
project is present, the operator has a control panel, and the docs teach
the workflow.

### 6.2 Tasks

1. **Runtime trigger.** A bounded `before_agent_start` guidance block
   (mirror the sites-building skill trigger: "always use Sites when the
   project contains `.openai/hosting.json`") that activates only when the
   working directory is a Sites project; toggleable via config
   (e.g. `.pi/sites.json` `promotion.enabled`, default `true`); no-op when
   the bundle is missing. Tested.
2. **Tool descriptions.** Every tool carries a "use when" clause (init a
   new site; validate before saving a version; package for deployment;
   release desk before deploying).
3. **`/sites` menu TUI.** Status of the current project: hosting.json
   summary, build/check state, last release-log entry, bundle version
   found; actions: init/check/package/release. Headless degradation.
4. **Docs + skill alignment.** README gains an extension-usage section
   (install, tools, commands, workflow); `docs/design.md` updated; consider
   shipping a `sites` skill via the resources API if it adds value beyond
   the tool descriptions (decision recorded).
5. **Footer status.** While a Sites project is active, a bounded footer
   status line (bundle found/missing, project id short form) — no
   secrets, no full ids.

### 6.3 Acceptance criteria

- [ ] Trigger fires only in Sites projects, is bounded, toggleable, tested.
- [ ] `/sites` menu shows real project state in a live session.
- [ ] README + docs teach the full workflow; skill decision recorded.
- [ ] Footer status bounded and secret-free.
- [ ] `npm run check` green.

---

## 7. Final report and completion

The final report is the lasting record (the operator deletes GOAL.md when
the goal is done — do not delete it yourself). Deliver it as your final
message before marking the goal complete. It must contain:

1. **Agent tree** — every child: task name, role, model, effective
   reasoning (proving the `max` override held), scope, outcome; plus the
   multi-agent tools exercised (≥ 4) and children spawned (≥ 3).
2. **Per-workstream summary** — what was done and key decisions
   (especially: the capability matrix, the connector-automation decision,
   the bundle-version record, every config key added).
3. **Verification evidence** — the gate commands run and their final
   status; live init/check/package output; release-desk test results;
   UNVERIFIED items with reasons.
4. **Commit hashes** — final HEAD of pi-sites.
5. **Deferred / unverified items** — with exact reasons.

Completion rule: mark complete **only** when every workstream's acceptance
checklist is satisfied, the gate is green, and this report is delivered.
Nothing less.
