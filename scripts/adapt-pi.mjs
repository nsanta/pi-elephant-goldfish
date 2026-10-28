#!/usr/bin/env node
/**
 * adapt-pi.mjs — apply scripted Pi adaptations to vendored EGM content.
 *
 * Policy (UPSTREAM.md): vendored files stay byte-identical to upstream except
 * for the substitutions below. Every substitution is anchored to exact upstream
 * patterns; if a pattern is missing where expected, this script FAILS so that
 * upstream drift is detected instead of silently shipping un-adapted content.
 *
 * Substitutions:
 *   1. Harness header  -> point Pi users at docs/pi.md
 *   2. Delegation block -> egm_goldfish / egm_ask contract (skills that spawn)
 *   3. ask_question     -> egm_ask (gate tool name)
 *   4. Plugin-root paths (agents/, resources/) -> skill-relative ../../ paths
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(ROOT, "skills");

let failures = 0;
const stats = [];

function fail(msg) {
  console.error(`adapt-pi: FAIL ${msg}`);
  failures++;
}

function sub(content, pattern, replacement, label, file, expectedMin = 1) {
  let count = 0;
  const out = content.replace(pattern, (...args) => {
    count++;
    if (typeof replacement === "function") return replacement(...args);
    return replacement;
  });
  if (count < expectedMin) {
    fail(`${file}: pattern for "${label}" matched ${count}x, expected >= ${expectedMin}`);
  }
  return [out, count];
}

const PI_HEADER =
  "When running in Pi, first read the Pi harness guide at `../../docs/pi.md` before using this skill.";

// Upstream delegation block: starts identically in every spawning skill; ends
// with either the review-stop sentence or the bootstrap inline-scout sentence.
const DELEGATION_RE =
  /A Goldfish runs in a fresh context[\s\S]*?(?:not a Goldfish review\.|run the scout steps inline\.)/g;

function piDelegation(file) {
  if (file.includes("bootstrap")) {
    return (
      "A Goldfish runs in a fresh context with no conversation history. In Pi, do not spawn subagents yourself: call the `egm_goldfish` tool registered by this package, passing the persona shortname or persona path, the standard, the target, and the range. It launches zero-context `pi --print` subprocesses restricted to read-only tools and returns their findings. Present interactive gates with the `egm_ask` tool. " +
      "If your harness has no `egm_goldfish` tool, run the scout steps inline."
    );
  }
  return (
    "A Goldfish runs in a fresh context with no conversation history. In Pi, do not spawn subagents yourself: call the `egm_goldfish` tool registered by this package, passing the reviewer shortnames or persona paths, the standard mapping, the target file, and the range. It launches zero-context `pi --print` subprocesses restricted to read-only tools, fans reviewers out in parallel, normalizes and deduplicates their findings, and returns the report path and summary. Present interactive gates with the `egm_ask` tool. " +
    "If the `pi` binary or the `egm_goldfish` tool is unavailable, stop and tell the user: a review in the same context is not a Goldfish review."
  );
}

// Rewrite plugin-root-relative tokens in backticks to skill-relative paths.
function relativize(content) {
  return content.replace(/`((?:agents|resources)\/[^`]+)`/g, (m, p) =>
    p.startsWith("../") ? m : "`../../" + p + "`"
  );
}

const skillDirs = readdirSync(SKILLS_DIR).filter((d) => !d.startsWith("."));
for (const dir of skillDirs) {
  const file = `skills/${dir}/SKILL.md`;
  const path = join(SKILLS_DIR, dir, "SKILL.md");
  let content = readFileSync(path, "utf8");
  const counts = {};

  // 1. Harness header (all skills carry the Codex/Claude pointer)
  [content, counts.header] = sub(
    content,
    /When running in Codex or ChatGPT Work[\s\S]*?first\./,
    PI_HEADER,
    "harness header",
    file
  );

  // 2. Delegation block (only spawning skills carry it - 0 is valid elsewhere)
  const hadDelegation = DELEGATION_RE.test(content);
  DELEGATION_RE.lastIndex = 0;
  if (hadDelegation) {
    [content, counts.delegation] = sub(
      content,
      DELEGATION_RE,
      piDelegation(dir),
      "delegation block",
      file
    );
  }

  // 3. Gate tool name
  [content, counts.gate] = sub(
    content,
    /ask_question/g,
    "egm_ask",
    "ask_question rename",
    file,
    0
  );

  // 4. Skill-relative paths
  const before = content;
  content = relativize(content);
  counts.paths = before === content ? 0 : 1;

  writeFileSync(path, content);
  stats.push({ file, ...counts });
}

for (const s of stats) {
  console.log(
    `adapt-pi: ${s.file} header=${s.header} delegation=${s.delegation ?? "-"} gate=${s.gate} paths=${s.paths}`
  );
}

if (failures > 0) {
  console.error(`adapt-pi: ${failures} failure(s) - upstream pattern drift? Re-check anchors.`);
  process.exit(1);
}
console.log("adapt-pi: all adaptations applied");
