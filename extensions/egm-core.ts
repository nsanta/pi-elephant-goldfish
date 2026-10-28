/**
 * pi-elephant-goldfish — EGM core extension for Pi.
 *
 * Elephant-Goldfish Model ported from google/elephant-goldfish-model (@ a8380ab).
 * Upstream content (skills/, agents/, resources/) is vendored under its original
 * Apache-2.0 license; this extension adds the Pi delegation layer:
 *
 *   - `egm_ask`       single-select interactive gate (upstream `ask_question` role)
 *   - `egm_goldfish`  zero-context reviewer spawning (upstream subagent-tool role)
 *   - `egm_state`     branch-aware pipeline state (durable custom entries)
 *   - `/egm-*`        command aliases injecting vendored skill payloads
 *
 * Phase 3: command UX and durable pipeline state are live; the review pipeline
 * itself stays model-driven from the vendored SKILL.md prose. Support modules
 * live under extensions/lib/ and are imported relatively; `extensions/*.ts`
 * stays the only top-level entry point.
 */
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { getSelectListTheme } from "@earendil-works/pi-coding-agent";
import { SelectList, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { registerEgmCommands } from "./lib/commands.ts";
import { registerGoldfishTool } from "./lib/goldfish.ts";
import { registerStateTool } from "./lib/state.ts";

export const EGM_VERSION = "0.1.0";

/**
 * Single-select dialog for `egm_ask`: wraps the pi-tui SelectList with the
 * question header and a hint footer. Arrow keys move, number keys (1-9) jump,
 * Enter confirms, Esc/Ctrl+C cancels.
 */
class AskSelectDialog {
  private readonly list: SelectList;

  constructor(
    private readonly question: string,
    private readonly options: string[],
    private readonly theme: Theme,
    private readonly done: (result: number | null) => void,
  ) {
    const items = options.map((label, index) => ({ value: String(index), label }));
    this.list = new SelectList(items, Math.min(items.length, 8), getSelectListTheme());
    this.list.onSelect = (item) => this.done(Number(item.value));
    this.list.onCancel = () => this.done(null);
  }

  handleInput(data: string): void {
    const digit = data.match(/^[1-9]$/);
    if (digit) {
      const index = Number(data) - 1;
      if (index < this.options.length) {
        this.done(index);
      }
      return;
    }
    this.list.handleInput(data);
  }

  render(width: number): string[] {
    const lines: string[] = [];
    lines.push("");
    lines.push(truncateToWidth(this.theme.fg("accent", this.theme.bold(this.question)), width));
    lines.push("");
    lines.push(...this.list.render(width));
    lines.push("");
    lines.push(truncateToWidth(this.theme.fg("dim", "↑/↓ or 1-9 select · Enter confirm · Esc cancel"), width));
    return lines;
  }

  invalidate(): void {
    this.list.invalidate();
  }
}

type AskDetails =
  | { selected: number; option: string }
  | { selected: null }
  | { mode: "plain-chat-fallback" };

const AskParams = Type.Object({
  question: Type.String({ minLength: 1, description: "The single question to ask the user." }),
  options: Type.Array(Type.String(), {
    minItems: 2,
    maxItems: 8,
    description: "2-8 plain option strings. Do not add '(Recommended)' style prefixes.",
  }),
});

export default function egmCore(pi: ExtensionAPI) {
  pi.registerCommand("egm-version", {
    description: "Show the pi-elephant-goldfish package version",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`pi-elephant-goldfish ${EGM_VERSION}`, "info");
    },
  });

  pi.registerTool({
    name: "egm_ask",
    label: "EGM Ask",
    description:
      "Single-select interactive gate for EGM workflows. Call it as the SOLE tool call in the turn, with exactly one question and 2-8 plain options (no '(Recommended)' prefixes). If no interactive UI is available, the tool result tells you to ask the question in plain chat instead.",
    parameters: AskParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<{
      content: [{ type: "text"; text: string }];
      details: AskDetails;
    }> {
      if (ctx.hasUI && ctx.mode === "tui") {
        const selected = await ctx.ui.custom<number | null>(
          (_tui, theme, _keybindings, done) =>
            new AskSelectDialog(params.question, params.options, theme, done),
        );
        if (selected === null || selected === undefined) {
          return {
            content: [
              {
                type: "text",
                text: "User dismissed the question. Ask them in plain chat how to proceed.",
              },
            ],
            details: { selected: null },
          };
        }
        const option = params.options[selected] ?? "";
        return {
          content: [{ type: "text", text: `User selected: ${option}` }],
          details: { selected, option },
        };
      }

      const optionList = params.options.map((option, index) => `${index + 1}) ${option}`).join(" ");
      return {
        content: [
          {
            type: "text",
            text: `No interactive UI in this mode. Ask the user in plain chat and end your turn: ${params.question} Options: ${optionList}`,
          },
        ],
        details: { mode: "plain-chat-fallback" },
      };
    },
  });

  registerGoldfishTool(pi);
  registerStateTool(pi);
  registerEgmCommands(pi);
}
