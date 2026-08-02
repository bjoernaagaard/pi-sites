// ---------------------------------------------------------------------------
// pi-sites — custom TUI menu component (ctx.ui.custom + pi-tui SelectList)
//
// A keyboard-driven menu rendered through the pi extension API: status lines
// on top, a SelectList below (↑↓ navigate · enter select · esc cancel). The
// component closes with the chosen action; dialogs and edits run after it
// closes, then the menu reopens with a refreshed status pane.
//
// Mode guards: ctx.ui.custom() resolves undefined in RPC mode, so callers
// must fall back to the select-loop / text path when mode !== "tui".
// ---------------------------------------------------------------------------

import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  type KeybindingsManager,
  type SelectItem,
  SelectList,
  Text,
  type TUI,
} from "@earendil-works/pi-tui";

const MAX_VISIBLE_ITEMS = 12;

/** pi's run modes (ExtensionMode is not re-exported from the package entry). */
export type MenuMode = "tui" | "rpc" | "json" | "print";

/**
 * The exact shape of ExtensionUIContext.custom as a method declaration, so
 * structural contexts stay assignable from the real ExtensionCommandContext
 * (methods are checked bivariantly; function-type aliases are not).
 */
export interface MenuUi {
  // biome-ignore lint/style/useConsistentMethodSignatures: a method declaration keeps parameter checking bivariant, which is required for structural assignability from the real ExtensionUIContext
  custom<T>(
    factory: (
      tui: TUI,
      theme: Theme,
      keybindings: KeybindingsManager,
      done: (result: T) => void
    ) =>
      | (Component & { dispose?: () => void })
      | Promise<Component & { dispose?: () => void }>,
    options?: unknown
  ): Promise<T>;
}

/** Structural subset of the extension UI needed by the menu component. */
export interface TuiMenuContext {
  mode: MenuMode;
  ui: MenuUi;
}

/**
 * Build the menu component (title + status pane + SelectList). Exported so
 * the component can be unit-tested with fakes (render + keyboard handling).
 */
export function buildMenuComponent<T extends string>(
  title: string,
  items: SelectItem[],
  statusLines: string[],
  tui: { requestRender: () => void },
  theme: Theme,
  done: (value: T | null) => void
): Component {
  const container = new Container();
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
  container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
  for (const line of statusLines.slice(0, 12)) {
    container.addChild(new Text(theme.fg("dim", line), 1, 0));
  }
  container.addChild(new Text("", 1, 0));
  const list = new SelectList(
    items,
    Math.min(items.length, MAX_VISIBLE_ITEMS),
    {
      description: (t) => theme.fg("muted", t),
      noMatch: (t) => theme.fg("warning", t),
      scrollInfo: (t) => theme.fg("dim", t),
      selectedPrefix: (t) => theme.fg("accent", t),
      selectedText: (t) => theme.fg("accent", t),
    }
  );
  list.onSelect = (item) => done(item.value as T);
  list.onCancel = () => done(null);
  container.addChild(list);
  container.addChild(
    new Text(theme.fg("dim", "↑↓ navigate · enter select · esc cancel"), 1, 0)
  );
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
  return {
    handleInput: (data: string) => {
      list.handleInput(data);
      tui.requestRender();
    },
    invalidate: () => container.invalidate(),
    render: (width: number) => container.render(width),
  };
}

/**
 * Open a keyboard-driven TUI menu. Returns the selected item value, or null
 * when cancelled/closed. Returns null immediately when the mode is not "tui"
 * (RPC/print/json) — callers degrade to their select-loop/text path.
 */
export async function openTuiMenu<T extends string>(
  ctx: TuiMenuContext,
  title: string,
  items: SelectItem[],
  statusLines: string[]
): Promise<T | null> {
  if (ctx.mode !== "tui") {
    return null;
  }
  const result = await ctx.ui.custom<T | null>(
    (
      tui: TUI,
      theme: Theme,
      _kb: KeybindingsManager,
      done: (value: T | null) => void
    ) => buildMenuComponent(title, items, statusLines, tui, theme, done)
  );
  return result ?? null;
}

/** Build SelectItems from label/value pairs with optional descriptions. */
export function menuItems(
  entries: Array<{ description?: string; label: string; value: string }>
): SelectItem[] {
  return entries.map((entry) => ({
    description: entry.description,
    label: entry.label,
    value: entry.value,
  }));
}
