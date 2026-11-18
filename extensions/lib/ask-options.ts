/**
 * `egm_ask` option normalization.
 *
 * The EGM skills direct the model to present gate options "each with its
 * mechanism, trade-offs, and the conditions under which it fails", and models
 * routinely reach for the {title, description} object shape popularized by
 * harness ask tools (pi's own ask_user accepts it). A strict string-only
 * schema rejects that shape at validation time, wedging the human gate on a
 * retry loop instead of surfacing the question. This module lets `egm_ask`
 * accept both shapes and normalize them into display-ready options.
 *
 * Pure module: imports nothing, so it is testable without the host runtime.
 */

/** One raw option as the model may send it: a plain string or a structured object. */
export type RawAskOption = string | { title: string; description?: string };

/** A display-ready option: title on the list line, optional description on the detail line. */
export interface AskOption {
  title: string;
  description?: string;
}

/**
 * Strip "(Recommended)"-style bias markers from an option title. The EGM
 * interaction invariant bans the model from marking a default; enforcing the
 * ban at normalization time makes the invariant API-enforced instead of
 * advisory. Ordinary prose containing the word "recommended" is untouched.
 */
export function stripRecommendedMarker(text: string): string {
  let out = text;
  // Leading markers: "(Recommended) Keep as-is", "Recommended: keep as-is".
  out = out.replace(/^\s*[（(]\s*recommended\s*[)）]\s*[:：-]?\s*/i, "");
  out = out.replace(/^\s*recommended\s*[:：]\s*/i, "");
  // Trailing markers: "Remove the router (Recommended)".
  out = out.replace(/\s*[:：-]?\s*[（(]\s*recommended\s*[)）]\s*$/i, "");
  return out.trim();
}

/** Collapse newlines so an option renders as a single line everywhere. */
function flattenToSingleLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, " ").trim();
}

/**
 * Normalize a raw options array into display-ready options. Accepts plain
 * strings, {title, description} objects, or a mix; null/undefined entries and
 * options left empty after marker stripping are dropped.
 */
export function normalizeAskOptions(raw: readonly RawAskOption[]): AskOption[] {
  const options: AskOption[] = [];
  for (const entry of raw) {
    if (entry === null || entry === undefined) continue;
    if (typeof entry === "string") {
      const title = stripRecommendedMarker(entry);
      if (title) options.push({ title });
      continue;
    }
    const title = stripRecommendedMarker(String(entry.title ?? ""));
    if (!title) continue;
    const description =
      entry.description === undefined || entry.description === null
        ? undefined
        : flattenToSingleLine(String(entry.description));
    options.push(description ? { title, description } : { title });
  }
  return options;
}

/** Render an option for plain-text surfaces ("title" or "title — description"). */
export function formatAskOption(option: AskOption): string {
  return option.description ? `${option.title} — ${option.description}` : option.title;
}
