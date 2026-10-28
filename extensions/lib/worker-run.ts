/**
 * Read-write EGM bootstrap worker child runner.
 *
 * Mirrors the goldfish.ts reviewer runner, but spawns `pi --print` children
 * with write/edit tools so bootstrap workers can generate and correct contract
 * files. Self-contained by design: goldfish.ts is not modified.
 */
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import path from "node:path";

const WORKER_TOOLS = "read,grep,find,ls,write,edit";
const STDERR_TAIL_CHARS = 500;
const KILL_ESCALATION_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 900_000;
const DEFAULT_MAX_CONCURRENT = 3;

/** Same guidance string as the goldfish runner: a same-context fallback is not a Goldfish. */
export const PI_UNAVAILABLE_GUIDANCE =
  "The pi binary is unavailable, so zero-context Goldfish delegation cannot run. Stop and tell the user: a review in the same context is not a Goldfish review.";

export type WorkerStatus = "ok" | "timeout" | "error";

export interface WorkerChildResult {
  status: WorkerStatus;
  stdout: string;
  stderrTail?: string;
  exitCode?: number | null;
  errorMessage?: string;
}

/** Locate an executable `pi` on PATH; null when unresolvable. */
export function findPiBinary(): string | null {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, "pi");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not executable here; keep scanning.
    }
  }
  return null;
}

/** Bootstrap worker child timeout in ms (`EGM_BOOTSTRAP_TIMEOUT_MS`, default 900000, clamped >= 1). */
export function getBootstrapTimeoutMs(): number {
  const raw = Number(process.env.EGM_BOOTSTRAP_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.max(1, Math.floor(raw));
}

/** Max simultaneous worker children (`EGM_BOOTSTRAP_MAX_CONCURRENT`, default 3, clamped >= 1). */
export function getBootstrapMaxConcurrent(): number {
  const raw = Number(process.env.EGM_BOOTSTRAP_MAX_CONCURRENT);
  if (!Number.isFinite(raw) || raw < 1) {
    return DEFAULT_MAX_CONCURRENT;
  }
  return Math.max(1, Math.floor(raw));
}

/** SIGTERM first, then SIGKILL after a grace period if the child lingers. */
export function killChildEscalating(child: ReturnType<typeof spawn>): void {
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

/**
 * Run one read-write `pi --print` worker child. Resolves (never rejects);
 * failures are encoded in `status`. Kills the child on timeout (SIGTERM then
 * SIGKILL after 5s) and on outer abort.
 */
export function runWorkerChild(
  prompt: string,
  workspaceRoot: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  toolsFlag: string = WORKER_TOOLS,
): Promise<WorkerChildResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let stdout = "";
    let stderr = "";

    const child = spawn(
      "pi",
      ["--print", "--no-session", "--tools", toolsFlag, prompt],
      { cwd: workspaceRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );

    const finish = (status: WorkerStatus, errorMessage?: string) => {
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

/**
 * Bounded-concurrency job pool. Results keep the input order. `fn` receives
 * each job plus the outer abort signal (undefined when none was supplied).
 */
export async function runPool<T, R>(
  jobs: T[],
  concurrency: number,
  fn: (job: T, signal: AbortSignal | undefined) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(jobs.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, async () => {
    while (nextIndex < jobs.length) {
      const index = nextIndex++;
      results[index] = await fn(jobs[index], signal);
    }
  });
  await Promise.all(workers);
  return results;
}
