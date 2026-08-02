// ---------------------------------------------------------------------------
// pi-sites — ChatGPT Sites tooling for Pi
//
// Scaffold status: this is the initial extension skeleton. The extension is
// based on the ChatGPT Sites field guide in README.md (portable notes for
// starting, maintaining, or handing over ChatGPT Sites projects). It is
// very early stage: no Sites functionality exists yet.
// ---------------------------------------------------------------------------

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function piSites(pi: ExtensionAPI): void {
  // Placeholder tool: proves the tool pipeline works end to end.
  pi.registerTool({
    description:
      "Scaffold placeholder tool for the pi-sites extension. " +
      "Returns the extension status. Real ChatGPT Sites workflows " +
      "will replace this.",
    execute() {
      return Promise.resolve({
        content: [{ text: "pi-sites scaffold loaded.", type: "text" as const }],
        details: {},
      });
    },
    label: "Sites Ping",
    name: "sites_ping",
    parameters: Type.Object({}),
  });

  // Placeholder command: real Sites workflows land here later.
  pi.registerCommand("sites", {
    description: "Show the pi-sites scaffold status",
    handler: (_args, ctx) => {
      if (ctx.hasUI) {
        ctx.ui.notify(
          "pi-sites scaffold loaded (early stage — no Sites workflows yet).",
          "info"
        );
      }
      return Promise.resolve();
    },
  });
}
