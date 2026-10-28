#!/usr/bin/env node
/**
 * check-content.mjs — content checks for the vendored EGM pi port.
 *
 * a. Frontmatter: every SKILL.md directly under a skills/ subdirectory and
 *    every markdown file in agents/ must carry YAML frontmatter between
 *    leading `---` fences with a non-empty `name` (lowercase/hyphen pattern)
 *    and a non-empty `description`. A SKILL.md without
 *    `disable-model-invocation: true` is a warning, not a failure.
 *
 * b. Link integrity: every `.md` under `skills/`, `agents/`, `resources/`,
 *    `docs/` is scanned for markdown links `[text](target)` with a relative
 *    target; the target must resolve to an existing file or directory.
 *    Scanning follows the semantics of upstream `test_link_integrity.py`
 *    (the reference implementation this check ports, see PLAN.md):
 *    fenced code blocks and inline backtick spans are stripped first, since
 *    links inside them are literal examples, not rendered links. Targets are
 *    skipped when not relative (http/https, leading `#` anchor, mailto),
 *    site-absolute (leading `/`), or template placeholders (containing `${`).
 *    A `#fragment` suffix is stripped before resolving against the file's
 *    directory. Two known-unported upstream targets are allowlisted by their
 *    resolved repository-relative path (see ALLOWED_MISSING_TARGETS below);
 *    every other missing target still fails.
 *
 * Prints a summary; exits 1 on any failure. Warnings do not fail the run.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["skills", "agents", "resources", "docs"];

let failures = 0;
let warnings = 0;

function fail(msg) {
  console.error(`check-content: FAIL ${msg}`);
  failures++;
}

function warn(msg) {
  console.warn(`check-content: WARN ${msg}`);
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

// Minimal frontmatter key reader: plain scalars plus block scalars (>-, |, ...).
// No YAML dependency; vendored frontmatter only uses these forms.
function readFrontmatter(content, file) {
  const lines = content.split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== "---") {
    fail(`${file}: no leading '---' frontmatter fence`);
    return null;
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    fail(`${file}: no closing '---' frontmatter fence`);
    return null;
  }
  const block = lines.slice(1, endIdx);
  const data = {};
  let i = 0;
  while (i < block.length) {
    const m = block[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    let value = m[2].trim();
    if (value === "" || /^[>|][+-]?\d*$/.test(value)) {
      const rest = [];
      i++;
      while (i < block.length && (block[i].startsWith(" ") || block[i].startsWith("\t") || block[i].trim() === "")) {
        rest.push(block[i].trim());
        i++;
      }
      value = rest.join(" ").trim();
    } else {
      value = value.replace(/^["']|["']$/g, "");
      i++;
    }
    data[key] = value;
  }
  return data;
}

function checkFrontmatter() {
  const targets = [];
  const skillsDir = join(ROOT, "skills");
  if (existsSync(skillsDir)) {
    for (const dir of readdirSync(skillsDir).filter((d) => !d.startsWith("."))) {
      const skillFile = join(skillsDir, dir, "SKILL.md");
      if (existsSync(skillFile)) targets.push(skillFile);
      else fail(`skills/${dir}: SKILL.md missing`);
    }
  }
  const agentsDir = join(ROOT, "agents");
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir).filter((f) => f.endsWith(".md"))) {
      targets.push(join(agentsDir, f));
    }
  }

  for (const path of targets) {
    const file = relative(ROOT, path);
    const fm = readFrontmatter(readFileSync(path, "utf8"), file);
    if (!fm) continue;
    const name = typeof fm.name === "string" ? fm.name.trim() : "";
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
      fail(`${file}: frontmatter 'name' missing or not lowercase/hyphen (${JSON.stringify(fm.name ?? "")})`);
    }
    const description = typeof fm.description === "string" ? fm.description.trim() : "";
    if (!description) {
      fail(`${file}: frontmatter 'description' missing or empty`);
    }
    if (file.includes("SKILL.md") && fm["disable-model-invocation"] !== "true") {
      warn(`${file}: 'disable-model-invocation: true' missing from frontmatter`);
    }
  }
  return targets.length;
}

// ---------------------------------------------------------------------------
// Link integrity
// ---------------------------------------------------------------------------

function walkMarkdown(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!entry.startsWith(".")) out.push(...walkMarkdown(full));
    } else if (entry.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

// Allowlist of known-unported upstream link targets, keyed by the path the
// broken target resolves to, relative to the repository root (POSIX
// separators). Matching on the resolved path means ANY file linking the same
// missing target is allowed, while every other missing target still fails.
// Each entry is a deliberate, temporary exception — remove it when its reason
// no longer holds.
const ALLOWED_MISSING_TARGETS = new Set([
  // WHY: referenced by the 7 vendored skills/*/TEST.md files, which point at
  // upstream's root test-suite documentation. This port has not yet ported the
  // upstream test suite (PLAN.md schedules that for Phase 5), so no TESTING.md
  // exists at the repository root.
  // REMOVE WHEN: Phase 5 adds this repository's own TESTING.md; the vendored
  // links then resolve on their own and this exception must not linger.
  "TESTING.md",
  // WHY: resources/README.md links the upstream documentation index. This port
  // intentionally ships docs/pi.md only (see UPSTREAM.md), so docs/index.md has
  // no equivalent here.
  // REMOVE WHEN: a docs index is vendored or written under docs/, making the
  // link resolve.
  "docs/index.md",
]);

function checkLinks() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const full = join(ROOT, dir);
    if (existsSync(full)) files.push(...walkMarkdown(full));
  }

  let linksChecked = 0;
  for (const path of files) {
    const file = relative(ROOT, path);
    const content = readFileSync(path, "utf8");
    // Strip fenced code blocks and inline backtick spans: links inside them
    // are literal examples, not rendered links (upstream semantics).
    const clean = content
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`\n]*`/g, "");

    const lines = clean.split(/\r?\n/);
    for (const match of clean.matchAll(LINK_RE)) {
      const target = match[2].trim();
      // Count line number from the pre-strip content position offset.
      const upTo = clean.slice(0, match.index);
      const lineNo = (upTo.match(/\n/g) || []).length + 1;
      const loc = `${file}:${lineNo}`;

      if (target.includes("${")) continue; // template placeholder
      if (/^(https?:)?\/\//i.test(target) || target.startsWith("mailto:")) continue;
      if (target.startsWith("#")) continue; // intra-document anchor
      if (target.startsWith("/")) continue; // site-absolute, not relative

      const fileTarget = target.split("#")[0];
      if (!fileTarget) continue;

      linksChecked++;
      const resolved = resolve(dirname(path), fileTarget);
      const relTarget = relative(ROOT, resolved).split(sep).join("/");
      if (!existsSync(resolved) && !ALLOWED_MISSING_TARGETS.has(relTarget)) {
        fail(`${loc}: broken relative link '[${match[1]}](${target})' -> ${relTarget} does not exist`);
      }
    }
  }
  return { files: files.length, linksChecked };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const fmCount = checkFrontmatter();
const { files, linksChecked } = checkLinks();

console.log(
  `check-content: frontmatter checked for ${fmCount} file(s); ` +
    `link integrity over ${files} markdown file(s), ${linksChecked} relative link(s)`
);
if (warnings > 0) console.log(`check-content: ${warnings} warning(s)`);
if (failures > 0) {
  console.error(`check-content: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-content: all checks passed");
