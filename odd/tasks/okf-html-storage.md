# OKF-HTML storage — docs in HTML (default) or Markdown, OKF-cataloged

Status: implemented (2026-11-24) — okf_god `feature/okf-html` (a4afe8e + 3cdc03e, 161 tests); pilot migrated on `feat/okf-html-docs`. Lightweight process, user-approved decisions recorded below.
Date: 2026-11-24 · Revised same day: format is selectable (D1 v2)
Repos: `okf_god` (tooling, format profile) · `pi-elephant-goldfish` (pilot migration)

## Goal

Store project documentation in the Open Knowledge Format with a **selectable
per-document storage format: self-contained HTML (default) or Markdown**.
In HTML docs the YAML frontmatter block is replaced by `<meta>` tags in
`<head>`. okf-god indexes both formats as first-class citizens; linking,
trust/staleness, and search behavior stay unchanged, and links are
format-agnostic so a document can switch format without breaking the graph.

## Decisions (settled with user 2026-11-24)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Storage model | **Selectable per document — HTML (default) or Markdown** (v2; supersedes the initial HTML-only choice, history below) |
| D2 | Metadata carrier | **Meta tags, `okf:` prefixed** (e.g. `<meta name="okf:type" content="doc">`) |
| D3 | Scope | okf-god gains `.html` support alongside `.md`; **pilot migration = this repo's `docs/`** to the default HTML format; skills/agents stay markdown (pi loads them natively) |
| D4 | Process | Lightweight: this plan → implement (no EGM lifecycle) |

**D1 rationale (v2).** Nothing is in production, so there is no migration
debt either way. HTML-default wins because docs become real viewable pages in
a browser, consistent with the repo's artifact-forger philosophy — while
keeping Markdown as a first-class per-document option removes the main
risk of the HTML-only model (authoring friction) without sync tooling: there
is no mirroring, each document exists in exactly one chosen format. The
original HTML-only rationale (single source of truth) is preserved by the
one-file-per-doc rule; its fallback (a md→html generator) is no longer
needed because Markdown itself is the escape hatch.

**Consequence for AGENTS.md:** the line "Markdown is the source of truth;
HTML artifacts are human-facing projections" is re-scoped: *artifacts* keep
that rule; cataloged `docs/` default to the HTML format, with Markdown
allowed per document. Skills and `agents/*.md` stay markdown — pi itself
loads their frontmatter.

## Format rules (the contract)

- **Markdown docs** remain governed by the existing OKF v0.2 markdown spec
  (YAML frontmatter) — nothing changes for them.
- **HTML docs** follow the OKF-HTML v0.1 profile below.

### OKF-HTML v0.1 profile

An OKF-HTML document is a UTF-8 `.html` file, valid enough for any HTML
parser, structured as:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Architecture</title>                    <!-- maps to `title` -->
  <meta name="okf:type" content="doc">           <!-- §4.1 fields -->
  <meta name="okf:resource" content="okf-html">
  <meta name="okf:status" content="stable">
  <meta name="okf:stale_after" content="2027-01-01">
  <meta name="okf:generated.at" content="2026-11-24T10:00:00Z">  <!-- dotted keys -->
  <meta name="okf:tags" content="format">        <!-- lists: repeat the tag -->
  <meta name="okf:tags" content="okf-god">
</head>
<body>
  <!-- semantic HTML body; concept links: <a href="pi.html"> or the
       format-agnostic bundle-relative /pi -->
</body>
</html>
```

Rules:

1. **Scalars**: one `<meta name="okf:<field>" content="<value>">` per field.
   Dotted YAML keys map 1:1 to dotted meta names (`generated.at` → `okf:generated.at`).
2. **Lists** (`tags`, `sources`): repeat the same meta name; order = document order.
3. **`<title>`** element maps to the `title` field; no `okf:title` meta needed.
4. **Permissive (§11)**: unknown `okf:*` fields tolerated; zero `okf:` metas =
   valid permissive doc (entry indexes with name only). Never reject.
5. **Reserved filenames**: `index.html`, `log.html` are not cataloged.
6. **Links (§6)**: `<a href="pi.html">` and extension-less `/pi` are concept
   links. Extension-less bundle-relative targets are format-agnostic:
   resolved against the entry's root, then same-kind roots, trying `.html`
   first (default), then `.md`. `http(s):`, `mailto:`, `#anchor` ignored.
   Broken links tolerated and kept. **Authoring guidance**: in HTML docs,
   prefer extension-bearing relative hrefs (`pi.html`) — clickable under
   `file://`; `/name` is graph-parity fallback, unclickable in browsers.
7. **Mixed bundles**: `.md` and `.html` coexist in one catalog; format is
   selected per document, defaulting to HTML for new docs. A document exists
   in exactly one format at a time (no mirrors, no sync).
8. **Names**: doc slug = filename minus extension (`pi.html` → `pi`);
   skill/agent rules unchanged (they stay markdown).
9. **Slug collisions**: `pi.md` and `pi.html` in the same root both index
   (distinct paths, distinct mtime fingerprints). Name-based lookup prefers
   the `.html` entry (default format); exact-path lookup is unambiguous.

## Implementation phases

### Phase 0 — spec + failing tests first (okf_god)
- Write this profile as **the first OKF-HTML doc**: `okf_god/docs/okf-html.html`
  (dogfoods the format; it is also the fixture the tests read).
- Strict TDD: smallest failing tests for the meta parser before implementing.

### Phase 1 — metadata + catalog (okf_god)
- New `src/htmlmeta.ts`: `parseHtmlMeta(raw) -> {ok, data, body}` with the same
  shape as `parseFrontmatter`; body = `<body>` inner HTML. Never throws (§11).
- `catalog.ts`: accept `.html` alongside `.md`; reserved names
  (`index.html`/`log.html`) + per-kind slug rules per profile; tolerate slug
  collisions across extensions (name lookup prefers `.html`). Description
  indexed from `okf:description` (with plain `name="description"` accepted as
  fallback alias).
- Unit tests: scalars, dotted keys, repeated tags, missing/unclosed head, no
  metas, CRLF, BOM, unknown fields; slug-collision catalog cases.

### Phase 2 — graph, reader, search (okf_god)
- `graph.ts`: extract `<a href>` concept links; extension-less bundle-relative
  targets (`/pi`) resolve `.html`-first then `.md` (format-agnostic links);
  exact `.html`/`.md` paths still resolve; reuse existing `/abs` + relative
  machinery.
- `reader.ts`: for `.html`, return **extracted readable text** (strip
  `script`/`style`/`head`, block tags → newlines, headings kept as text lines,
  cap at `maxChars`), so model context is not flooded by tags. Hand-rolled,
  ~60 lines, no new dependencies (repo keeps only `yaml` vendored).
- `search.ts`: section/heading extraction from `<h1..h6>` text.
- Unit tests + integration: index a mixed md/html tree, extension-less + exact
  hrefs across formats, broken links tolerated.

### Phase 3 — pilot migration (pi-elephant-goldfish)
- Convert `docs/architecture.md`, `docs/pi.md`, `docs/upstream-pr.md`,
  `docs/archive/update.md` to OKF-HTML. NOTE: these files have **no frontmatter
  today** (plain markdown, indexed permissively per §11) — so this is the first
  real authoring of OKF metadata: set `okf:type`, `okf:status`,
  `okf:stale_after`, `okf:resource` deliberately rather than converting
  existing YAML. Body = semantic HTML; internal links rewritten to
  extension-bearing relative form (`pi.html`) — browser-safe under `file://`
  and resolvable by the graph.
- Delete the `.md` originals after conversion — each pilot doc adopts the
  default HTML format; future docs may choose Markdown per document.
- Update `AGENTS.md`: docs are OKF-cataloged and default to **HTML format**;
  Markdown remains an allowed per-document alternative; the artifacts
  markdown-sourcing rule is scoped to artifacts only.
- Live smoke: `/okf-reload` → `okf_list`, `okf_read pi`, `okf_links pi`,
  `/okf-graph` shows the new edges; broken-link count unchanged.

### Phase 4 — closeout
- Update okf_god README (`What gets indexed`, OKF alignment table row for the
  HTML profile).
- Deferred (explicitly out of scope): migrating `resources/document_standards/`
  (EGM reviewers read them via plain `read`; move only after reviewers adopt
  `okf_read`); upstream OKF spec proposal to GoogleCloudPlatform/knowledge-catalog;
  JSON-LD carrier; EGM pipeline artifacts (briefs/drafts/reports) stay markdown
  working files; optional follow-up: a small `okf-convert` script (md↔html) for
  switching an existing document's format.

## Verification

- Every behavior change lands test-first (observed failing → passing).
- Live evidence at Phase 3: catalog lists migrated docs, `okf_read` returns
  extracted text (no raw tags), link graph intact, zero new broken links,
  and a mixed-format catalog (any remaining `.md` doc) still resolves.

## Risks / open questions

- **Authoring friction**: hand-writing HTML is noisier; mitigated by the fixed
  skeleton, okf-god text extraction for re-reading, and — since D1 v2 — by
  Markdown itself being a per-document option.
- **Raw readability**: HTML docs are tag-noisy under `rg`/GitHub; Markdown docs
  stay fully readable. `okf_read` is the blessed reader path for HTML.
- **Token cost**: authoring HTML costs ~1.5–2× markdown tokens. Mitigated by
  format choice (write quick/plain docs as markdown); revisit if large docs
  adopt HTML.
- **Text extraction fidelity**: tables and code blocks in HTML need sensible
  plain-text rendering; keep the stripper conservative and tested.
- **Duplicate slugs**: `pi.md` + `pi.html` coexisting could confuse name-based
  lookup; rule 9 (prefer `.html`) covers it and is tested in Phase 1.
