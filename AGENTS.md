## Engineering principles

- Do not preserve backward compatibility. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
- Grow the system in layers. Start from the smallest version that works end to end, and add each new capability on top of a product that already works. Never trade a working product for unfinished complexity.
- Keep components modular and concerns clearly separated.
- Prefer established, well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear reason.
- Lean on the dependencies already in the project before writing your own implementation or adding packages. Do not assume a library lacks a capability without checking its documentation and types.
- Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.

# AGENTS.md

This repository is a Pi extension. The package name is `pi-sites`.
It adds ChatGPT Sites workflow tools to Pi: `sites_init`, `sites_check`,
`sites_package`, and `sites_diagnose`, plus the `/sites` command.

## Work commands

Run `npm install` once after you clone.

| Command | What it does |
| --- | --- |
| `npm run check` | Run lint, typecheck, and a package dry-run. |
| `npm run test` | Run the test suite. |
| `npm run typecheck` | Type-check the source with `tsc --noEmit`. |
| `npm run fix` | Format and lint-fix with ultracite. |

Run `npm run check` and `npm run test` before you commit.

## Layout

- `src/index.ts` — the extension entry: registers the tools and
  `/sites`.
- `src/core/` — the workflow engines: init, validate, package, hosting,
  bundle, secrets, and git.
- `src/commands.ts` — the slash commands.
- `src/connector-tools.ts` — the control-plane connector tools.
- `src/menu-tui.ts` — the TUI menu.
- `tests/` — the test suite.

## Code standards

This repository uses Ultracite, a zero-config preset for strict code
quality. Follow the ultracite skill.

Quick reference:

- Format code: `npm exec -- ultracite fix`
- Check for issues: `npm exec -- ultracite check`
- Diagnose setup: `npm exec -- ultracite doctor`

Write code that is accessible, performant, type-safe, and maintainable.

- Name every variable for the value it holds.
- Use explicit types where they clarify the code.
- Use `const` by default; use `let` only when reassignment is needed.
- Await every promise in an async function. Use the return value.
- Use `try-catch` where a rejection needs handling; let other errors
  propagate.
- Throw `Error` objects with descriptive messages.
- Use early returns to reduce nesting.
- Keep functions focused; extract complex conditions into named boolean
  variables.
- Keep production code free of `console.log`, `debugger`, and `alert`
  statements.
- Write assertions inside `it()` or `test()` blocks. Remove `.only` and
  `.skip` before you commit.
- Keep test suites flat: nest `describe` blocks at most two levels.

## Extension specifics

The extension invokes the installed Sites plugin bundle scripts when they
are present. When the bundle is absent, it degrades gracefully with an
install-path hint.

- Keep the plugin bundle a reference and an invoked binary, never a source
  to copy.
- Keep the release order: save-version, private-deploy, access and domain,
  public-release.
- Keep credentials out of URLs, git configuration, commits, and `.env`;
  store them as managed environment values.
- Keep the connector a managed capability: delegate to the ChatGPT or
  Codex environment, and call no undocumented endpoints.
