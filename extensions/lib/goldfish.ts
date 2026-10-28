/**
 * `egm_goldfish` — zero-context Goldfish reviewer spawning.
 *
 * Fans reviewer personas out as fresh `pi --print` child processes restricted
 * to read-only tools, collects their findings, tallies severities
 * deterministically, and writes a consolidated report file (artifact-first:
 * the tool result only carries the report path and a summary, never the full
 * report content).
 */
import { spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getGoldfishMaxConcurrent, getGoldfishTimeoutMs, resolveArtifactDir } from "./artifact-dir.ts";
import { resolvePersona, resolveStandard, type ResolvedResource } from "./paths.ts";

const CHILD_TOOLS = "read,grep,find,ls";
const STDERR_TAIL_CHARS = 500;
const KILL_ESCALATION_MS = 5_000;

const PI_UNAVAILABLE_GUIDANCE =
  "The pi binary is unavailable, so zero-context Goldfish review cannot run. Stop and tell the user: a review in the same context is not a Goldfish review.";

const GoldfishParams = Type.Object({
  reviewers: Type.Array(Type.String(), {
    minItems: 1,
    maxItems: 12,
    description:
      "Persona shortnames (e.g. zoom_out, design_critic) or persona file paths (absolute, or relative to the workspace root). 1-12 reviewers.",
  }),
  targetFile: Type.String({
    description: "The document under review (absolute path, or relative to the workspace root).",
  }),
  range: Type.Optional(
    Type.String({
      description: 'Target range within the document, e.g. "12-48". Omit or use "full file" for the whole file.',
    }),
  ),
  semanticTarget: Type.Optional(
    Type.String({
      description: "Descriptive targeting string passed through to reviewers, e.g. 'the error-handling subsections'.",
    }),
  ),
  standards: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description:
        "Map of reviewer input name (as given in `reviewers`) to a document standard shortname or standard file path that reviewer must enforce.",
    }),
  ),
  goldfishContext: Type.Optional(
    Type.Array(Type.String(), {
      description: "Baseline reading list (file paths) each reviewer reads before judging.",
    }),
  ),
  mode: Type.Optional(
    Type.Union([Type.Literal("review"), Type.Literal("brainstorm")], {
      default: "review",
      description: "Reviewer mode. review: audit and report findings. brainstorm: same rigor, generative focus.",
    }),
  ),
  outputFileName: Type.Optional(
    Type.String({
      description: "Report filename inside the artifact directory (a number is appended if the file already exists).",
    }),
  ),
});

type ReviewerStatus = "ok" | "timeout" | "error";

interface ChildOutcome {
  reviewer: ResolvedResource;
  standard?: ResolvedResource;
  status: ReviewerStatus;
  stdout: string;
  stderrTail?: string;
  exitCode?: number | null;
  errorMessage?: string;
}

/** Locate an executable `pi` on PATH; null when unresolvable. */
function findPiBinary(): string | null {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, "pi");
    try {
      fsAccessOk(candidate);
      return candidate;
    } catch {
      // Not executable here; keep scanning.
    }
  }
  return null;
}

function fsAccessOk(file: string): void {
  accessSync(file, constants.X_OK);
}

function killChildEscalating(child: ReturnType<typeof spawn>): void {
  try {
    child.kill("SIGTERM");
  } catch {
    // Already gone.
  }
  const escalation = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  }, KILL_ESCALATION_MS);
  escalation.unref?.();
  child.once("close", () => clearTimeout(escalation));
}

interface ChildResult {
  status: ReviewerStatus;
  stdout: string;
  stderrTail?: string;
  exitCode?: number | null;
  errorMessage?: string;
}

/**
 * Run one `pi --print` reviewer child. Resolves (never rejects); failures are
 * encoded in `status`. Kills the child on timeout (SIGTERM then SIGKILL after
 * 5s) and on outer abort.
 */
function runGoldfishChild(
  piBinary: string,
  prompt: string,
  workspaceRoot: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<ChildResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let stdout = "";
    let stderr = "";

    const child = spawn(
      piBinary,
      ["--print", "--no-session", "--tools", CHILD_TOOLS, prompt],
      { cwd: workspaceRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );

    const finish = (status: ReviewerStatus, errorMessage?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onOuterAbort);
      resolve({
        status,
        stdout,
        stderrTail: stderr ? stderr.slice(-STDERR_TAIL_CHARS) : undefined,
        exitCode: child.exitCode,
        errorMessage,
      });
    };

    const onOuterAbort = () => killChildEscalating(child);
    signal?.addEventListener("abort", onOuterAbort, { once: true });

    const timeout = setTimeout(() => {
      timedOut = true;
      killChildEscalating(child);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        finish("error", PI_UNAVAILABLE_GUIDANCE);
        return;
      }
      finish("error", err.message);
    });

    child.on("close", (code, signalName) => {
      if (signal?.aborted) {
        finish("error", "aborted by user");
        return;
      }
      if (timedOut) {
        finish("timeout");
        return;
      }
      if (code === 0) {
        finish("ok");
        return;
      }
      finish("error", `exited with code ${code ?? "null"}${signalName ? ` (signal ${signalName})` : ""}`);
    });
  });
}

function buildChildPrompt(options: {
  personaPath: string;
  standardPath?: string;
  mode: "review" | "brainstorm";
  targetFile: string;
  range?: string;
  semanticTarget?: string;
  goldfishContext?: string[];
}): string {
  const lines: string[] = [];
  lines.push(
    "You are a Goldfish reviewer subagent: strictly read-only, zero prior conversation context, no chitchat, no narration of your tool usage.",
  );
  lines.push(`First read your persona definition at ${options.personaPath} and adopt it fully.`);
  if (options.standardPath) {
    lines.push(`Then read the evaluation standard at ${options.standardPath} and enforce it.`);
  }
  lines.push(`Mode: ${options.mode}.`);
  const targetParts = [`Target document: ${options.targetFile}`];
  targetParts.push(`[range: ${options.range ?? "full file"}]`);
  if (options.semanticTarget) {
    targetParts.push(`[semantic target: ${options.semanticTarget}]`);
  }
  lines.push(targetParts.join(" "));
  if (options.goldfishContext && options.goldfishContext.length > 0) {
    lines.push(`Baseline reading list (read these before judging): ${options.goldfishContext.join(", ")}`);
  }
  lines.push(
    `Audit the target per your persona${options.standardPath ? " and standard" : ""} and report findings as your FINAL message, each in exactly this format:`,
  );
  lines.push("Severity: Blocker|Major|Nit");
  lines.push("Scope: <line range or section heading>");
  lines.push("Description: <the gap>");
  lines.push("Rationale: <why it matters and what to do>");
  lines.push("Findings only. If you find none, your final message must be exactly: No findings.");
  return lines.join("\n");
}

/** Deterministic severity tally: count `Severity: <level>` markers in one report. */
function tallySeverities(text: string): { blocker: number; major: number; nit: number } {
  const tally = { blocker: 0, major: 0, nit: 0 };
  const pattern = /^[ \t]*(?:[-*][ \t]*)?(?:\*\*)?[ \t]*severity:[ \t]*(blocker|major|nit)\b/gim;
  for (const match of text.matchAll(pattern)) {
    const level = match[1]?.toLowerCase();
    if (level === "blocker" || level === "major" || level === "nit") {
      tally[level] += 1;
    }
  }
  return tally;
}

/** Pick `<base>.md`, then `<base>-2.md`, `-3.md`, ... inside `dir`. */
function nextAvailableReportPath(dir: string, fileName: string): string {
  const ext = ".md";
  const base = fileName.toLowerCase().endsWith(ext) ? fileName.slice(0, -ext.length) : fileName;
  let candidate = path.join(dir, `${base}${ext}`);
  let counter = 2;
  while (existsSync(candidate)) {
    candidate = path.join(dir, `${base}-${counter}${ext}`);
    counter += 1;
  }
  return candidate;
}

function buildReport(options: {
  targetFile: string;
  range?: string;
  mode: string;
  semanticTarget?: string;
  outcomes: ChildOutcome[];
}): string {
  const lines: string[] = [];
  lines.push("# Goldfish Review Report");
  lines.push("");
  lines.push(`- Target: ${options.targetFile}`);
  lines.push(`- Range: ${options.range ?? "full file"}`);
  lines.push(`- Mode: ${options.mode}`);
  lines.push(`- Date: ${new Date().toISOString()}`);
  if (options.semanticTarget) {
    lines.push(`- Semantic target: ${options.semanticTarget}`);
  }
  lines.push("- Reviewers:");
  for (const outcome of options.outcomes) {
    const standardNote = outcome.standard ? ` (standard: ${outcome.standard.canonicalName})` : "";
    lines.push(`  - ${outcome.reviewer.canonicalName} (${outcome.status})${standardNote}`);
  }
  lines.push("");
  for (const outcome of options.outcomes) {
    lines.push(`## ${outcome.reviewer.canonicalName} (${outcome.status})`);
    lines.push("");
    lines.push(outcome.stdout.trim().length > 0 ? outcome.stdout.trimEnd() : "(no output)");
    if (outcome.status !== "ok") {
      if (outcome.stderrTail) {
        lines.push("");
        lines.push("(stderr tail)");
        lines.push(outcome.stderrTail);
      }
      if (outcome.errorMessage) {
        lines.push("");
        lines.push(`(error: ${outcome.errorMessage})`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function singleLine(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Register the `egm_goldfish` tool. Runs reviewer children with bounded
 * concurrency (`EGM_GOLDFISH_MAX_CONCURRENT`, default 3) and per-child timeout
 * (`EGM_GOLDFISH_TIMEOUT_MS`, default 900000 ms).
 */
export function registerGoldfishTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "egm_goldfish",
    label: "EGM Goldfish",
    description:
      "Spawn zero-context Goldfish reviewer subprocesses (fresh `pi --print` processes restricted to read tools) over a target document range. Fans reviewers out in parallel, writes a consolidated findings report file, and returns the report path plus a summary. Never returns full report content (artifact-first): read the report file for details.",
    parameters: GoldfishParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const workspaceRoot = ctx.cwd;

      // Fail fast on unresolvable reviewers/standards before spawning anything.
      const requestedStandards = new Map<string, ResolvedResource>();
      const standardsMap: Record<string, string> = params.standards ?? {};
      for (const [reviewerName, standardName] of Object.entries(standardsMap)) {
        requestedStandards.set(reviewerName, resolveStandard(standardName, workspaceRoot));
      }

      const piBinary = findPiBinary();
      if (!piBinary) {
        throw new Error(PI_UNAVAILABLE_GUIDANCE);
      }
      signal?.throwIfAborted();

      const mode = params.mode ?? "review";
      const targetFile = path.isAbsolute(params.targetFile)
        ? params.targetFile
        : path.resolve(workspaceRoot, params.targetFile);
      const goldfishContext = (params.goldfishContext ?? []).map((p) =>
        path.isAbsolute(p) ? p : path.resolve(workspaceRoot, p),
      );

      const timeoutMs = getGoldfishTimeoutMs();
      const concurrency = getGoldfishMaxConcurrent();

      interface PlannedReviewer {
        reviewer: ResolvedResource;
        standard?: ResolvedResource;
        prompt: string;
      }
      const planned: PlannedReviewer[] = params.reviewers.map((reviewerName) => {
        const reviewer = resolvePersona(reviewerName, workspaceRoot);
        const standard = requestedStandards.get(reviewerName);
        const prompt = buildChildPrompt({
          personaPath: reviewer.absolutePath,
          standardPath: standard?.absolutePath,
          mode,
          targetFile,
          range: params.range,
          semanticTarget: params.semanticTarget,
          goldfishContext,
        });
        return { reviewer, standard, prompt };
      });

      // Bounded-concurrency fan-out.
      const outcomes: ChildOutcome[] = new Array(planned.length);
      let nextIndex = 0;
      const workers = Array.from({ length: Math.min(concurrency, planned.length) }, async () => {
        while (nextIndex < planned.length) {
          const index = nextIndex++;
          const plan = planned[index];
          const result = await runGoldfishChild(piBinary, plan.prompt, workspaceRoot, timeoutMs, signal);
          outcomes[index] = { reviewer: plan.reviewer, standard: plan.standard, ...result };
        }
      });
      await Promise.all(workers);
      signal?.throwIfAborted();

      const okCount = outcomes.filter((o) => o.status === "ok").length;
      const failedOutcomes = outcomes.filter((o) => o.status !== "ok");

      if (okCount === 0) {
        const tails = outcomes
          .map((o) => `${o.reviewer.canonicalName} (${o.status}): ${singleLine(o.errorMessage) || singleLine(o.stderrTail) || "no output"}`)
          .join("\n");
        throw new Error(`All ${outcomes.length} egm_goldfish reviewers failed.\n${tails}`);
      }

      // Severity tally over every captured stdout (deterministic; no dedupe).
      const total = { blocker: 0, major: 0, nit: 0 };
      const perReviewerTally = outcomes.map((outcome) => {
        const tally = tallySeverities(outcome.stdout);
        total.blocker += tally.blocker;
        total.major += tally.major;
        total.nit += tally.nit;
        return tally;
      });

      // Report filename and artifact directory.
      const artifactDir = resolveArtifactDir(workspaceRoot);
      const fallbackBase =
        planned.length === 1 ? `${planned[0].reviewer.canonicalName}_report` : "goldfish_review_report";
      const requestedName = params.outputFileName ? path.basename(params.outputFileName) : fallbackBase;

      const reportPath = await withFileMutationQueue(path.join(artifactDir, requestedName), async () => {
        const unique = nextAvailableReportPath(artifactDir, requestedName);
        await writeFile(unique, buildReport({
          targetFile,
          range: params.range,
          mode,
          semanticTarget: params.semanticTarget,
          outcomes,
        }), "utf8");
        return unique;
      });

      const contentLines = [
        `Findings written to ${reportPath}. Reviewers: ${okCount} ok, ${failedOutcomes.length} failed. Findings tally: ${total.blocker} Blocker, ${total.major} Major, ${total.nit} Nit.`,
      ];
      for (const failed of failedOutcomes) {
        const detail = singleLine(failed.errorMessage) || singleLine(failed.stderrTail) || "no stderr captured";
        contentLines.push(`Reviewer ${failed.reviewer.canonicalName}: ${failed.status} — ${detail}`);
      }

      return {
        content: [{ type: "text", text: contentLines.join("\n") }],
        details: {
          reportPath,
          reviewers: outcomes.map((outcome, index) => ({
            reviewer: outcome.reviewer.canonicalName,
            status: outcome.status,
            blocker: perReviewerTally[index].blocker,
            major: perReviewerTally[index].major,
            nit: perReviewerTally[index].nit,
          })),
        },
      };
    },
  });
}
