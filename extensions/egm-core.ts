/**
 * pi-elephant-goldfish — EGM core extension for Pi.
 *
 * Elephant-Goldfish Model ported from google/elephant-goldfish-model (@ a8380ab).
 * Upstream content (skills/, agents/, resources/) is vendored under its original
 * Apache-2.0 license; this extension adds the Pi delegation layer:
 *
 *   - `egm_ask`       single-select interactive gate (upstream `ask_question` role)
 *   - `egm_goldfish`  zero-context reviewer spawning (upstream subagent-tool role)
 *
 * Phase 0 scaffold: registers nothing yet beyond a version command.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const EGM_VERSION = "0.1.0";

export default function egmCore(pi: ExtensionAPI) {
  pi.registerCommand("egm-version", {
    description: "Show the pi-elephant-goldfish package version",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`pi-elephant-goldfish ${EGM_VERSION}`, "info");
    },
  });
}
