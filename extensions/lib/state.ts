/**
 * `egm_state` — minimal branch-aware EGM pipeline state.
 *
 * A long multi-stage review must survive compaction, so its state (preset,
 * stage, line ranges, report paths, iteration counts) is stored as custom
 * session entries: durable, excluded from model context, and reconstructed
 * from the current branch (`sessionManager.getBranch()`) — never from every
 * file entry, because abandoned branches are alternative histories.
 */
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** customType of the session entries holding EGM pipeline state. */
export const EGM_STATE_ENTRY_TYPE = "egm-state";

interface StateToolDetails {
  action: "set" | "get";
  saved?: boolean;
  found?: boolean;
}

const StateParams = Type.Object({
  action: Type.Union([Type.Literal("set"), Type.Literal("get")], {
    description: "set: persist the pipeline state. get: return the last saved state on this branch.",
  }),
  value: Type.Optional(
    Type.Unknown({
      description:
        "State to persist (required for action=set). Keep it a compact JSON-serializable object: preset, stage, line ranges, report paths, iteration counts.",
    }),
  ),
});

/**
 * Serialize one entry's state defensively; malformed or unserializable data
 * must never throw out of the scan.
 */
function serializeState(data: unknown): string | undefined {
  try {
    return JSON.stringify(data);
  } catch {
    return undefined;
  }
}

/** Return the most recently saved state on the current branch, or undefined. */
export function readLastSavedState(ctx: ExtensionToolContext): string | undefined {
  try {
    const branch = ctx.sessionManager.getBranch();
    for (let index = branch.length - 1; index >= 0; index--) {
      const entry = branch[index];
      if (entry.type !== "custom" || entry.customType !== EGM_STATE_ENTRY_TYPE) {
        continue;
      }
      const serialized = serializeState(entry.data);
      if (serialized !== undefined) {
        return serialized;
      }
    }
  } catch {
    // Defensive: an unreadable branch must not throw out of the tool.
  }
  return undefined;
}

/** Register the `egm_state` tool. */
export function registerStateTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "egm_state",
    label: "EGM State",
    description:
      "Persist or return the EGM review pipeline state for the current session branch. State survives compaction and branching. Use it at stage boundaries of long EGM review pipelines; store compact JSON (preset, stage, line ranges, report paths, iteration counts).",
    parameters: StateParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<{
      content: [{ type: "text"; text: string }];
      details: StateToolDetails;
    }> {
      if (params.action === "set") {
        if (params.value === undefined) {
          return {
            content: [{ type: "text", text: "Error: action 'set' requires a value." }],
            details: { action: "set", saved: false },
          };
        }
        // Custom entry: durable, excluded from model context.
        pi.appendEntry(EGM_STATE_ENTRY_TYPE, params.value);
        return {
          content: [{ type: "text", text: "State saved." }],
          details: { action: "set", saved: true },
        };
      }

      const state = readLastSavedState(ctx);
      if (state === undefined) {
        return {
          content: [{ type: "text", text: "(no saved state)" }],
          details: { action: "get", found: false },
        };
      }
      return {
        content: [{ type: "text", text: state }],
        details: { action: "get", found: true },
      };
    },
  });
}
