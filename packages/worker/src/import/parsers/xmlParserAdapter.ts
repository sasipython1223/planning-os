/**
 * @module xmlParserAdapter
 *
 * Thin adapter around fast-xml-parser for Worker-safe XML parsing.
 *
 * Responsibilities:
 * - Strip BOM
 * - Validate XML structure
 * - Parse XML to a plain JS object with namespace prefixes removed
 * - Keep all tag values as strings (no auto-type coercion)
 * - Force specified tag names to always be arrays
 *
 * ⚠️ ISOLATED — no imports from protocol, state, kernel, or other pipeline modules.
 * Library types are not exported; callers receive `unknown`.
 */

import { XMLParser, XMLValidator } from "fast-xml-parser";

// ─── Result Types ───────────────────────────────────────────────────

export type XmlParseSuccess = {
  readonly ok: true;
  readonly data: unknown;
};

export type XmlParseFailure = {
  readonly ok: false;
  readonly error: string;
};

export type XmlParseResult = XmlParseSuccess | XmlParseFailure;

// ─── Tag names that must always be arrays even when single ──────────

const ARRAY_TAGS = new Set([
  "Task",
  "Resource",
  "Assignment",
  "PredecessorLink",
]);

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Parse a raw XML string into a plain JS object.
 *
 * - Strips UTF-8 BOM
 * - Removes namespace prefixes (e.g. `msproject:Task` → `Task`)
 * - Keeps all values as strings
 * - Forces collection tags to always be arrays
 *
 * @param rawXml  The full XML file content as a string.
 * @returns       Success with parsed object, or failure with error message.
 */
export function parseXmlToObject(rawXml: string): XmlParseResult {
  // Strip BOM and whitespace
  const cleanXml = rawXml.replace(/^\uFEFF/, "").trim();

  if (cleanXml.length === 0) {
    return { ok: false, error: "Empty XML input" };
  }

  // ── Validate structure before parsing ─────────────────────────
  // XMLValidator catches malformed / truncated XML that XMLParser
  // would silently accept with partial data (no silent data loss).
  try {
    const validation = XMLValidator.validate(cleanXml);
    if (validation !== true) {
      const detail = typeof validation === "object" && validation.err
        ? `${validation.err.msg} (line ${validation.err.line}, col ${validation.err.col})`
        : "invalid XML structure";
      const snippet = cleanXml.slice(0, 200);
      return { ok: false, error: `XML validation failed: ${detail} — input starts with: ${snippet}` };
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown validator error";
    const snippet = cleanXml.slice(0, 200);
    return { ok: false, error: `XML validator threw: ${msg} — input starts with: ${snippet}` };
  }

  // ── Parse with namespace removal and string-only values ───────
  const parser = new XMLParser({
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
    ignoreAttributes: true,
    isArray: (_name: string) => ARRAY_TAGS.has(_name),
  });

  let data: unknown;
  try {
    data = parser.parse(cleanXml);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown XML parse error";
    const snippet = cleanXml.slice(0, 200);
    return { ok: false, error: `XML parser threw: ${msg} — input starts with: ${snippet}` };
  }

  // ── Verify the parse produced a non-empty object ──────────────
  if (data == null || typeof data !== "object" || Object.keys(data as object).length === 0) {
    const snippet = cleanXml.slice(0, 200);
    return { ok: false, error: `XML parsed to empty result — input starts with: ${snippet}` };
  }

  return { ok: true, data };
}
