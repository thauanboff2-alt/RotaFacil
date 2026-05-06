/**
 * Link Parser
 * Extracts Google Maps links and associated labels (name/empreendimento)
 * from raw text — e.g. pasted WhatsApp conversations.
 */

import { LinkEntry } from "@/types";

// ─────────────────────────────────────────────
// URL detection
// ─────────────────────────────────────────────

const GOOGLE_MAPS_PATTERNS = [
  /https?:\/\/maps\.app\.goo\.gl\/\S+/gi,
  /https?:\/\/goo\.gl\/maps\/\S+/gi,
  /https?:\/\/(www\.)?google\.[a-z]{2,6}(\.[a-z]{2})?\/maps\/\S+/gi,
  /https?:\/\/maps\.google\.[a-z]{2,6}(\.[a-z]{2})?\/\S+/gi,
];

function extractGoogleMapsLink(line: string): string | null {
  for (const pattern of GOOGLE_MAPS_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(line);
    if (match) return cleanUrl(match[0]);
  }
  return null;
}

function cleanUrl(url: string): string {
  return url.replace(/[.,;:!?)>\]]+$/, "");
}

export function isGoogleMapsLink(url: string): boolean {
  return GOOGLE_MAPS_PATTERNS.some((p) => {
    p.lastIndex = 0;
    return p.test(url);
  });
}

export function isShortLink(url: string): boolean {
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(url);
}

// ─────────────────────────────────────────────
// Line classification
// ─────────────────────────────────────────────

/**
 * Strip WhatsApp timestamps (e.g. "23:02 ✓", "23:02 ✓✓", "10:30") from end of line.
 * Also strips leading date separators like "10/05/2025, 23:00".
 */
function cleanLine(raw: string): string {
  return raw
    .trim()
    // Remove trailing WhatsApp timestamp + read-receipt ticks
    .replace(/\s+\d{1,2}:\d{2}\s*[\u2713\u2714✓✓]*\s*$/, "")
    // Remove full date+time prefix like "10/05/2025, 23:00 - Name:"
    .replace(/^\d{1,2}\/\d{1,2}\/\d{4},?\s*\d{1,2}:\d{2}\s*[-–]?\s*/, "")
    .trim();
}

/**
 * Returns true for lines that are WhatsApp link-preview metadata or
 * other noise that should be ignored when looking for a label.
 */
function isMetaLine(line: string): boolean {
  if (!line) return true;
  // Domain-only lines (link preview footer)
  if (/^(maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.[a-z.]+)$/i.test(line)) return true;
  // WhatsApp breadcrumb: "City · City, State"
  if (/\s·\s/.test(line)) return true;
  // Pure date separator: "10/05/2025"
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(line)) return true;
  // "Mensagem apagada" or similar system messages
  if (/^mensagem apagada$/i.test(line)) return true;
  // Emoji-only lines
  if (/^[\p{Emoji}\s]+$/u.test(line) && line.length <= 5) return true;
  return false;
}

// ─────────────────────────────────────────────
// Label splitting
// ─────────────────────────────────────────────

/**
 * Split a label like "Tiago Bublitz - correção de solo" into
 * clientName = "Tiago Bublitz" and empreendimento = "correção de solo".
 * Handles em-dashes and en-dashes as separators too.
 */
function splitLabel(label: string): { clientName: string; empreendimento: string } {
  if (!label) return { clientName: "", empreendimento: "" };
  const parts = label.split(/\s*[-–—]\s+/);
  if (parts.length >= 2) {
    return {
      clientName: parts[0].trim(),
      empreendimento: parts.slice(1).join(" - ").trim(),
    };
  }
  return { clientName: label.trim(), empreendimento: "" };
}

// ─────────────────────────────────────────────
// Main parser
// ─────────────────────────────────────────────

/**
 * Parse raw pasted text (e.g. from WhatsApp) and extract
 * { link, clientName, empreendimento } for each Google Maps link found.
 *
 * Strategy:
 * 1. Clean each line (strip timestamps, date headers).
 * 2. Classify lines: link | meta | text.
 * 3. For each link line, look at adjacent text lines (skipping meta lines)
 *    to find the best label — prefer the line immediately after, then before.
 */
export function parseEntriesFromText(text: string): LinkEntry[] {
  if (!text.trim()) return [];

  const rawLines = text.split(/[\n\r]+/);

  type ClassifiedLine = {
    cleaned: string;
    link: string | null;
    isMeta: boolean;
  };

  const lines: ClassifiedLine[] = rawLines.map((raw) => {
    const cleaned = cleanLine(raw);
    const link = extractGoogleMapsLink(cleaned);
    return {
      cleaned,
      link,
      isMeta: !link && isMetaLine(cleaned),
    };
  });

  const entries: LinkEntry[] = [];
  const usedAsLabel = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const { link } = lines[i];
    if (!link) continue;

    let label = "";

    // Look ahead (up to 4 lines, skip meta)
    for (let j = i + 1; j < lines.length && j <= i + 4; j++) {
      const next = lines[j];
      if (next.link) break; // hit another link → stop
      if (next.isMeta || !next.cleaned) continue;
      if (!usedAsLabel.has(j)) {
        label = next.cleaned;
        usedAsLabel.add(j);
        break;
      }
    }

    // Fallback: look behind (up to 3 lines, skip meta)
    if (!label) {
      for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
        const prev = lines[j];
        if (prev.link) break;
        if (prev.isMeta || !prev.cleaned) continue;
        if (!usedAsLabel.has(j)) {
          label = prev.cleaned;
          usedAsLabel.add(j);
          break;
        }
      }
    }

    const { clientName, empreendimento } = splitLabel(label);

    entries.push({
      id: crypto.randomUUID(),
      link,
      clientName,
      empreendimento,
    });
  }

  return entries;
}

/** Count how many valid Google Maps links are in a text blob. */
export function countLinksInText(text: string): number {
  return parseEntriesFromText(text).length;
}
