// ---------------------------------------------------------------------------
// pi-sites — TUI menu component unit tests (node:test + node:assert/strict)
//
// The component (title + status pane + SelectList) is tested with fakes:
// render(width) must contain the title, status lines, item labels, and help
// text; handleInput must navigate (down/up), select on enter, cancel on esc.
// The ctx.ui.custom wiring itself is TUI-mode only (headless UNVERIFIED by
// design — custom() resolves undefined outside TUI).
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";

import { buildMenuComponent, menuItems } from "../src/menu-tui.ts";

// SelectList matches raw terminal sequences via the default keybindings.
const KEY_UP = "\u001b[A";
const KEY_DOWN = "\u001b[B";
const KEY_ENTER = "\r";
const KEY_ESCAPE = "\u001b";

function fakeTheme(): Theme {
  return {
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  } as unknown as Theme;
}

const ITEMS = menuItems([
  { label: "Toggle promotion.enabled", value: "toggle-promotion" },
  { label: "Set connector.command", value: "set-connector" },
  { label: "Back", value: "back" },
]);

function makeComponent(done: (value: string | null) => void) {
  const renders: string[][] = [];
  const component = buildMenuComponent(
    "Sites — edit settings",
    ITEMS,
    [
      "promotion.enabled=true · connector.command=disabled",
      "release log: no entries",
    ],
    { requestRender: () => undefined },
    fakeTheme(),
    done
  );
  renders.push(component.render(80));
  return { component, renders };
}

test("component renders title, status lines, items, and help", () => {
  const { renders } = makeComponent(() => {
    // render-only probe; selection is covered by the key tests
  });
  const text = renders[0].join("\n");
  assert.ok(text.includes("Sites — edit settings"));
  assert.ok(
    text.includes("promotion.enabled=true · connector.command=disabled")
  );
  assert.ok(text.includes("release log: no entries"));
  assert.ok(text.includes("Toggle promotion.enabled"));
  assert.ok(text.includes("Set connector.command"));
  assert.ok(text.includes("Back"));
  assert.ok(text.includes("↑↓ navigate"));
});

test("component selects the first item on enter", () => {
  let selected: string | null | undefined;
  const { component } = makeComponent((value) => {
    selected = value;
  });
  component.handleInput(KEY_ENTER);
  assert.equal(selected, "toggle-promotion");
});

test("component navigates with down/up before selecting", () => {
  let selected: string | null | undefined;
  const { component } = makeComponent((value) => {
    selected = value;
  });
  component.handleInput(KEY_DOWN);
  component.handleInput(KEY_DOWN);
  component.handleInput(KEY_ENTER);
  assert.equal(selected, "back");
  // up again from the top wraps or clamps; selecting still works
  const { component: second } = makeComponent((value) => {
    selected = value;
  });
  second.handleInput(KEY_UP);
  second.handleInput(KEY_ENTER);
  assert.ok(selected !== null && selected !== undefined);
});

test("component cancels with escape", () => {
  let selected: string | null | undefined = "unset";
  const { component } = makeComponent((value) => {
    selected = value;
  });
  component.handleInput(KEY_ESCAPE);
  assert.equal(selected, null);
});

test("menuItems maps entries to SelectItems", () => {
  const items = menuItems([{ description: "desc", label: "A", value: "a" }]);
  assert.deepEqual(items, [{ description: "desc", label: "A", value: "a" }]);
});
