/**
 * API Route: POST /api/resolve-links
 *
 * Receives an array of Google Maps links, expands short URLs,
 * and extracts place information (name, coordinates, address, place_id).
 *
 * Resolution strategy:
 * 1. If short link (maps.app.goo.gl) → follow redirects to get expanded URL
 * 2. Extract place_id from URL if available
 * 3. Extract coordinates from the expanded URL
 * 4. Extract place name/query from URL
 * 5. If place_id found → use Places Details API (most accurate)
 * 6. If coordinates found → use Geocoding API to get address and name
 * 7. If only query → use Places API text search to resolve
 *
 * Security: short URL expansion is restricted to known Google domains (SSRF protection).
 * Performance: links are resolved concurrently in batches of 5.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveLinksRequestSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limiter";
import { ResolvedPlace, UnresolvedLink } from "@/types";

const API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

// Rate limit: 60 resolve requests per minute per IP
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;

// Concurrency: resolve this many links simultaneously
const CONCURRENCY = 5;

// Timeout for each external API call (ms)
const FETCH_TIMEOUT_MS = 8000;

// Allowed hostnames when following short-link redirects (SSRF protection)
const ALLOWED_REDIRECT_HOST =
  /^(maps\.app\.goo\.gl|goo\.gl|maps\.google\.[a-z]{2,6}(\.[a-z]{2})?|www\.google\.[a-z]{2,6}(\.[a-z]{2})?|google\.[a-z]{2,6}(\.[a-z]{2})?)$/i;

// Private / reserved IP ranges and hostnames that must never be reached (defense-in-depth)
const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|.*\.localhost)$|^(10|127|169\.254|192\.168)\.\d|^172\.(1[6-9]|2\d|3[01])\.\d|^::1$|^fd[0-9a-f]{2}:|^fe80:/i;

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST.test(hostname);
}

export async function POST(request: NextRequest) {
  // ── Rate limiting ──────────────────────────
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const rl = checkRateLimit(`resolve:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Muitas requisições. Aguarde um momento e tente novamente." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  try {
    const body = await request.json();
    const parsed = resolveLinksRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Requisição inválida", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    if (!API_KEY) {
      return NextResponse.json(
        { error: "Serviço de mapas não configurado." },
        { status: 500 }
      );
    }

    const { links } = parsed.data;
    const resolved: ResolvedPlace[] = [];
    const failed: UnresolvedLink[] = [];

    // ── Parallel resolution in batches ────────
    for (let i = 0; i < links.length; i += CONCURRENCY) {
      const chunk = links.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(chunk.map(resolveLink));

      for (let j = 0; j < settled.length; j++) {
        const r = settled[j];
        if (r.status === "fulfilled" && r.value) {
          resolved.push(r.value);
        } else {
          failed.push({
            originalLink: chunk[j],
            error:
              r.status === "rejected"
                ? r.reason instanceof Error
                  ? r.reason.message
                  : "Erro ao resolver link"
                : "Não foi possível obter a localização deste link",
          });
        }
      }
    }

    return NextResponse.json({ resolved, failed });
  } catch {
    return NextResponse.json(
      { error: "Erro interno. Tente novamente." },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────
// Link resolution pipeline
// ─────────────────────────────────────────────

async function resolveLink(link: string): Promise<ResolvedPlace | null> {
  let expandedUrl = link;

  // Step 1: Expand short links (with SSRF protection)
  // Strip WhatsApp/app tracking params before expanding to get a cleaner redirect
  const cleanLink = link.replace(/[?&]g_st=[^&]*/g, "").replace(/[?&]$/, "");
  if (/goo\.gl/i.test(cleanLink)) {
    expandedUrl = await expandShortUrl(cleanLink);
  }

  // Debug log visible in Vercel Function Logs (not exposed to users)
  console.log(`[resolve] original="${link}" expanded="${expandedUrl}"`);

  // Step 2: Extract data from URL
  const placeId = extractPlaceId(expandedUrl);
  const coords = extractCoordinates(expandedUrl);
  const query = extractQuery(expandedUrl);

  // Step 3: Resolve using best available data
  if (placeId) {
    // CID hex format (0x...:0x...) may not be accepted by Places API — fall through on failure
    const byId = await resolveByPlaceId(placeId, link);
    if (byId) return byId;
    // If CID lookup failed, continue to coords / text search below
  }

  if (coords) {
    return resolveByCoordinates(coords.lat, coords.lng, link, query);
  }

  if (query) {
    return resolveByTextSearch(query, link);
  }

  return null;
}

async function expandShortUrl(url: string): Promise<string> {
  // Validate origin URL is from an allowed Google domain (prevent SSRF)
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("URL inválida.");
  }

  if (!ALLOWED_REDIRECT_HOST.test(parsed.hostname) || isPrivateHost(parsed.hostname)) {
    throw new Error("URL não permitida.");
  }

  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RotaFacil/1.0)" },
    });

    // Only allow redirects to known Google domains (no private IPs)
    const finalHost = new URL(response.url).hostname;
    if (!ALLOWED_REDIRECT_HOST.test(finalHost) || isPrivateHost(finalHost)) {
      throw new Error("Redirecionamento para domínio não permitido.");
    }

    return response.url || url;
  } catch (err) {
    if (err instanceof Error && err.message.includes("não permitido")) throw err;

    // Fallback: GET request
    try {
      const signal2 = AbortSignal.timeout(FETCH_TIMEOUT_MS);
      const response = await fetch(url, {
        redirect: "follow",
        signal: signal2,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; RotaFacil/1.0)" },
      });

      const finalHost = new URL(response.url).hostname;
      if (!ALLOWED_REDIRECT_HOST.test(finalHost) || isPrivateHost(finalHost)) {
        throw new Error("Redirecionamento para domínio não permitido.");
      }

      return response.url || url;
    } catch (err2) {
      if (err2 instanceof Error && err2.message.includes("não permitido")) throw err2;
      throw new Error("Link curto inválido ou expirado.");
    }
  }
}

function extractPlaceId(url: string): string | null {
  // Standard place_id= parameter (ChIJ... format)
  const match = url.match(/place_id[=:]([A-Za-z0-9_-]+)/);
  if (match) return match[1];

  // ftid= parameter (older format)
  const ftidMatch = url.match(/ftid=(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  if (ftidMatch) return ftidMatch[1];

  // CID embedded in data= param: !1s0x<hex>:0x<hex>
  // e.g. /data=!4m2!3m1!1s0x94de8fbb2cdf0287:0xbbe0a865ebfd2ade
  const cidMatch = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  if (cidMatch) return cidMatch[1];

  return null;
}

function extractCoordinates(url: string): { lat: number; lng: number } | null {
  const try2 = (m: RegExpMatchArray | null) => {
    if (!m) return null;
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    return isValidCoords(lat, lng) ? { lat, lng } : null;
  };

  // @lat,lng,zoom — most common share/pin format
  return (
    try2(url.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/)) ||
    // ll=lat,lng
    try2(url.match(/[?&]ll=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/)) ||
    // q=lat,lng
    try2(url.match(/[?&]q=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/)) ||
    // center=lat,lng
    try2(url.match(/[?&]center=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/)) ||
    // sll=lat,lng (older Google Maps)
    try2(url.match(/[?&]sll=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/)) ||
    // cbll=lat,lng (Street View)
    try2(url.match(/[?&]cbll=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/)) ||
    // !3d<lat>!4d<lng> inside data= param (Google Maps embed / share)
    try2(url.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/)) ||
    // /lat,lng/ in path (≥4 decimal places)
    try2(url.match(/\/(-?\d{1,3}\.\d{4,}),(-?\d{1,3}\.\d{4,})/)) ||
    null
  );
}

function isValidCoords(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function extractQuery(url: string): string | null {
  const placeMatch = url.match(/\/place\/([^/@?]+)/);
  if (placeMatch) {
    const decoded = decodeURIComponent(placeMatch[1]).replace(/\+/g, " ").trim();
    // When the path contains "Name - Street Address, City..." use only the first part
    // so the Places text search gets a clean business name instead of a full address string
    if (decoded.length > 50 && decoded.includes(" - ")) {
      const firstPart = decoded.split(/\s+-\s+/)[0].trim();
      if (firstPart.length >= 4) return firstPart;
    }
    return decoded;
  }

  const qMatch = url.match(/[?&]q=([^&]+)/);
  if (qMatch) {
    const val = decodeURIComponent(qMatch[1]).replace(/\+/g, " ").trim();
    if (!/^-?\d{1,3}\.\d+,-?\d{1,3}\.\d+$/.test(val)) return val;
  }

  const queryMatch = url.match(/[?&]query=([^&]+)/);
  if (queryMatch) {
    return decodeURIComponent(queryMatch[1]).replace(/\+/g, " ").trim();
  }

  return null;
}

// ─────────────────────────────────────────────
// Google APIs resolution
// ─────────────────────────────────────────────

async function resolveByPlaceId(
  placeId: string,
  originalLink: string
): Promise<ResolvedPlace | null> {
  const url =
    `https://maps.googleapis.com/maps/api/place/details/json` +
    `?place_id=${encodeURIComponent(placeId)}` +
    `&fields=name,formatted_address,geometry,place_id` +
    `&key=${API_KEY}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const data = await res.json();

  if (data.status === "OK" && data.result) {
    return {
      id: crypto.randomUUID(),
      originalLink,
      name: data.result.name || "Local desconhecido",
      address: data.result.formatted_address || "",
      coordinates: {
        lat: data.result.geometry.location.lat,
        lng: data.result.geometry.location.lng,
      },
      placeId: data.result.place_id,
      status: "resolved",
    };
  }

  return null;
}

async function resolveByCoordinates(
  lat: number,
  lng: number,
  originalLink: string,
  queryHint?: string | null
): Promise<ResolvedPlace> {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?latlng=${lat},${lng}` +
    `&key=${API_KEY}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const data = await res.json();

  let name = queryHint || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  let address = "";
  let placeId: string | undefined;

  if (data.status === "OK" && data.results?.[0]) {
    const result = data.results[0];
    address = result.formatted_address || "";
    placeId = result.place_id;

    if (!queryHint) {
      const poi = data.results.find(
        (r: { types: string[] }) =>
          r.types.includes("establishment") ||
          r.types.includes("point_of_interest")
      );
      if (poi) {
        name = poi.name || poi.formatted_address?.split(",")[0] || name;
      } else {
        name = address.split(",")[0] || name;
      }
    }
  }

  return {
    id: crypto.randomUUID(),
    originalLink,
    name,
    address,
    coordinates: { lat, lng },
    placeId,
    status: "resolved",
  };
}

async function resolveByTextSearch(
  query: string,
  originalLink: string
): Promise<ResolvedPlace | null> {
  const url =
    `https://maps.googleapis.com/maps/api/place/textsearch/json` +
    `?query=${encodeURIComponent(query)}` +
    `&key=${API_KEY}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const data = await res.json();

  if (data.status === "OK" && data.results?.[0]) {
    const result = data.results[0];
    return {
      id: crypto.randomUUID(),
      originalLink,
      name: result.name || query,
      address: result.formatted_address || "",
      coordinates: {
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
      },
      placeId: result.place_id,
      status: "resolved",
    };
  }

  return null;
}
