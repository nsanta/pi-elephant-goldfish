/**
 * `/egm-*` user commands: one alias per vendored EGM skill.
 *
 * The review pipeline itself stays model-driven from the vendored SKILL.md
 * prose (single source of truth, upstream philosophy). These commands only add
 * command UX: each reads the skill body (YAML frontmatter stripped) and starts
 * a normal user turn with it, so behavior is identical in TUI, RPC, JSON, and
 * print modes — no ctx.ui calls on the happy path.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { PACKAGE_ROOT } from "./paths.ts";

export interface EgmCommandSpec {
  /** Slash command name (registered as /<command>). */
  command: string;
  /** Vendored skill directory name under <PACKAGE_ROOT>/skills/. */
  skill: string;
  /** One-line description shown in command listings. */
  description: string;
}

/** The seven `/egm-*` skill aliases (each command name matches its skill directory). */
export const EGM_SKILL_COMMANDS: readonly EgmCommandSpec[] = [
  {
    command: "egm-brainstorm",
    skill: "egm-brainstorm",
    description: "Start an EGM brainstorming session (ideate and refine a concept)",
  },
  {
    command: "egm-draft",
    skill: "egm-draft",
    description: "Draft a design document section-by-section with the EGM Elephant",
  },
  {
    command: "egm-review",
    skill: "egm-review",
    description: "Run the EGM Goldfish review protocol on a design document",
  },
  {
    command: "egm-review-loop",
    skill: "egm-review-loop",
    description: "Run the EGM antagonistic review loop against a document standard",
  },
  {
    command: "egm-resolve",
    skill: "egm-resolve",
    description: "Resolve Goldfish findings into approved document edits",
  },
  {
    command: "egm-drift-report",
    skill: "egm-drift-report",
    description: "Detect drift between design documents and the code",
  },
  {
    command: "egm-bootstrap",
    skill: "egm-bootstrap",
    description: "Bootstrap EGM directory READMEs across a repository subtree",
  },
];

/**
 * Strip a leading YAML frontmatter block (a `---`-delimited block that starts
 * at byte 0) from a SKILL.md file, returning the instruction body.
 */
export function stripFrontmatter(markdown: string): string {
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  return match ? markdown.slice(match[0].length) : markdown;
}

/**
 * Compose the user-turn payload: the skill body, optionally followed by the
 * user's command arguments. The arguments section is omitted when empty.
 */
export function buildCommandPayload(skillBody: string, args: string): string {
  const body = skillBody.trim();
  const userArguments = args.trim();
  if (!userArguments) {
    return body;
  }
  return `${body}\n\n---\nUser arguments: ${userArguments}`;
}

function reportCommandError(message: string, ctx: ExtensionCommandContext): void {
  // The declared command-handler contract is `(args, ctx) => Promise<void>`:
  // there is no result value, so failures surface through the UI notification
  // (TUI and RPC) and stderr in every mode.
  if (ctx.hasUI) {
    try {
      ctx.ui.notify(message, "error");
    } catch {
      // Notification failures must not mask the original error.
    }
  }
  console.error(message);
}

function registerSkillCommand(pi: ExtensionAPI, spec: EgmCommandSpec): void {
  pi.registerCommand(spec.command, {
    description: spec.description,
    handler: async (args, ctx) => {
      const skillPath = path.join(PACKAGE_ROOT, "skills", spec.skill, "SKILL.md");
      let payload: string;
      try {
        payload = buildCommandPayload(stripFrontmatter(readFileSync(skillPath, "utf8")), args);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        reportCommandError(`/${spec.command}: cannot read ${skillPath} (${reason})`, ctx);
        return;
      }
      // Always triggers a normal user turn; no options needed.
      pi.sendUserMessage(payload);
    },
  });
}

/** Register the seven `/egm-*` skill-alias commands. */
export function registerEgmCommands(pi: ExtensionAPI): void {
  for (const spec of EGM_SKILL_COMMANDS) {
    registerSkillCommand(pi, spec);
  }
}
