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
 * 5. If place_id found → use Place Details (New) (most accurate)
 * 6. If coordinates found → use Geocoding API to get address and name
 * 7. If only query → use Text Search (New) to resolve
 *
 * Security: short URL expansion is restricted to known Google domains (SSRF protection).
 * Performance: links are resolved concurrently in batches of 5.
 *
 * NOTE: migrated from the Places API (Legacy) to the Places API (New).
 * Enable "Places API (New)" in the Google Cloud Console. The Geocoding API
 * calls are unchanged — that API is not legacy.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveLinksRequestSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limiter";
import { ResolvedPlace, UnresolvedLink } from "@/types";

const API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

// Places API (New) endpoints (replace the legacy /maps/api/place/* endpoints)
const PLACES_BASE = "https://places.googleapis.com/v1";

// The Places API (New) requires an explicit response field mask on every
// request; omitting it returns an error.
const PLACE_DETAILS_FIELD_MASK = "id,displayName,formattedAddress,location";
const PLACE_SEARCH_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location";

// Locale hints for the Places API (New)
const LANGUAGE_CODE = "pt-BR";
const REGION_CODE = "BR";

// Rate limit: 60 resolve requests per minute per IP
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;

// Concurrency: resolve this many links simultaneously
const CONCURRENCY = 5;

// Timeout for each external API call (ms)
const FETCH_TIMEOUT_MS = 8000;

/**
 * Browser-like User-Agent used when expanding short links.
 *
 * The previous value, "Mozilla/5.0 (compatible; RotaFacil/1.0)", has the shape
 * crawlers use. Google answers those with a consent/interstitial page served at
 * 200 instead of issuing the redirect, so fetch() returned the short URL itself
 * as response.url — no place_id, no coordinates, nothing to extract — and the
 * link was reported as unresolvable.
 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_UA,
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};

// Maximum redirect hops to follow manually when expanding a short link
const MAX_REDIRECTS = 6;

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
  let placeId = extractPlaceId(expandedUrl);
  let coords = extractCoordinates(expandedUrl);
  const query = extractQuery(expandedUrl);         // short name (business name only)
  const fullQuery = extractFullQuery(expandedUrl); // full decoded path (name + address)

  // Step 2b: if the expanded URL carries nothing usable, read the page itself.
  // This covers short links that land on an interstitial or consent page whose
  // URL has no place data but whose HTML still does.
  if (!placeId && !coords && !query && !fullQuery) {
    const fromHtml = await extractFromHtml(expandedUrl);
    placeId = placeId ?? fromHtml.placeId;
    coords = coords ?? fromHtml.coords;
    console.log(
      `[resolve] fallback HTML placeId=${fromHtml.placeId ?? "-"} coords=${
        fromHtml.coords ? `${fromHtml.coords.lat},${fromHtml.coords.lng}` : "-"
      }`
    );
  }

  // Step 3: Resolve using best available data — cascade through fallbacks

  // 3a. Place ID (standard ChIJ… works; legacy CID 0x… is skipped → continue)
  if (placeId) {
    const byId = await resolveByPlaceId(placeId, link);
    if (byId) return byId;
  }

  // 3b. Coordinates (most reliable, uses Geocoding API)
  if (coords) {
    return resolveByCoordinates(coords.lat, coords.lng, link, query);
  }

  // 3c. Text Search (New) with short name (requires Places API (New))
  if (query) {
    const byName = await resolveByTextSearch(query, link);
    if (byName) return byName;
  }

  // 3d. Text Search (New) with full address string (requires Places API (New))
  if (fullQuery && fullQuery !== query) {
    const byFull = await resolveByTextSearch(fullQuery, link);
    if (byFull) return byFull;
  }

  // 3e. Geocoding API with the address from URL path — works without Places API (New)
  //     e.g. "José Carlos Packer - Produtor Rural, Corupá - SC, 89278-000"
  //     → geocodes the city/address portion and returns approximate location
  if (fullQuery) {
    return resolveByAddressGeocoding(fullQuery, query || fullQuery, link);
  }

  // Nothing worked. Surface a message that says which stage came up empty,
  // so a failure in the logs can be told apart from a bad link.
  const expanded = expandedUrl !== link;
  throw new Error(
    expanded
      ? "O link foi expandido, mas o Google não retornou coordenadas nem nome para ele."
      : "O Google não expandiu este link curto (pode ter expirado ou estar bloqueando o servidor)."
  );
}

/**
 * Expand a Google short link into its full URL.
 *
 * Follows redirects manually, reading the Location header at each hop, instead
 * of relying on fetch's redirect:"follow" and response.url. Manual following is
 * what lets us tell "Google issued no redirect" apart from "Google redirected
 * somewhere we do not allow" — with redirect:"follow" both look identical, and
 * an interstitial served at 200 silently yields the original URL back.
 *
 * Every hop is validated against the allowed-host list (SSRF protection).
 */
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

  let current = url;

  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: BROWSER_HEADERS,
      });
    } catch {
      throw new Error("Não foi possível acessar o link curto (tempo esgotado ou rede).");
    }

    // Not a redirect — this is the final document
    if (res.status < 300 || res.status >= 400) {
      return current;
    }

    const location = res.headers.get("location");
    if (!location) return current;

    // Resolve relative redirects against the current URL
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return current;
    }

    if (!ALLOWED_REDIRECT_HOST.test(next.hostname) || isPrivateHost(next.hostname)) {
      throw new Error("Redirecionamento para domínio não permitido.");
    }

    current = next.toString();
  }

  return current;
}

/**
 * Last-resort extraction: download the Google Maps page and look for the
 * coordinates or place id inside the HTML.
 *
 * Needed when the short link resolves to a page whose URL carries no data —
 * Google sometimes serves the place through an interstitial or a consent page,
 * but the underlying document still contains the canonical URL and the
 * coordinates.
 */
async function extractFromHtml(
  url: string
): Promise<{ placeId: string | null; coords: { lat: number; lng: number } | null }> {
  const empty = { placeId: null, coords: null };

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return empty;
  }
  if (!ALLOWED_REDIRECT_HOST.test(host) || isPrivateHost(host)) return empty;

  let html: string;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: BROWSER_HEADERS,
    });
    if (!res.ok) return empty;
    html = await res.text();
  } catch {
    return empty;
  }

  // The canonical/og:url meta tag usually holds the full /place/ URL
  const canonical =
    html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1] ||
    html.match(/<meta[^>]+property="og:url"[^>]+content="([^"]+)"/i)?.[1] ||
    null;

  if (canonical) {
    const decoded = canonical.replace(/&amp;/g, "&");
    const fromCanonical = {
      placeId: extractPlaceId(decoded),
      coords: extractCoordinates(decoded),
    };
    if (fromCanonical.placeId || fromCanonical.coords) return fromCanonical;
  }

  // Fall back to scanning the document itself
  return {
    placeId: extractPlaceId(html),
    coords: extractCoordinates(html),
  };
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

  /**
   * Links shared from the Google Maps mobile app expand to
   *   /maps/search/-26.787513,+-52.654671?entry=tts
   * where the "+" is an encoded space. The comma is therefore NOT followed
   * directly by the longitude, which is what every pattern below assumes.
   * Normalising that separator away is what makes those links resolve.
   */
  const normalized = url
    .replace(/%2C/gi, ",")
    .replace(/%20/gi, " ")
    .replace(/,\s*\+\s*/g, ",")
    .replace(/,\s+/g, ",");

  url = normalized;

  // @lat,lng,zoom — most common share/pin format
  return (
    try2(url.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/)) ||
    // /maps/search/lat,lng — mobile app share format
    try2(url.match(/\/maps\/search\/(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/)) ||
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

  // /maps/search/<text> — mobile app share format for a named search
  const searchMatch = url.match(/\/maps\/search\/([^/@?]+)/);
  if (searchMatch) {
    const decoded = decodeURIComponent(searchMatch[1]).replace(/\+/g, " ").trim();
    // Skip when it is a coordinate pair — extractCoordinates handles those
    if (decoded && !/^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(decoded)) {
      return decoded;
    }
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

/**
 * Returns the full decoded place name + address from the URL path,
 * without truncation. Used as a last-resort text search query.
 */
function extractFullQuery(url: string): string | null {
  const placeMatch = url.match(/\/place\/([^/@?]+)/);
  if (!placeMatch) return null;
  const decoded = decodeURIComponent(placeMatch[1]).replace(/\+/g, " ").trim();
  return decoded || null;
}

// ─────────────────────────────────────────────
// Google APIs resolution
// ─────────────────────────────────────────────

/**
 * A single place as returned by the Places API (New),
 * limited to the fields requested in the field mask.
 */
interface NewPlace {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
}

interface NewPlaceError {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    /** Causa legível por máquina — ver comentário em optimize-route/route.ts */
    details?: unknown[];
  };
}

/**
 * Convert a Places API (New) place into a ResolvedPlace.
 * Returns null when the place carries no usable coordinates.
 */
function toResolvedPlace(
  place: NewPlace | undefined,
  originalLink: string,
  fallbackName: string
): ResolvedPlace | null {
  const lat = place?.location?.latitude;
  const lng = place?.location?.longitude;

  if (typeof lat !== "number" || typeof lng !== "number") return null;

  return {
    id: crypto.randomUUID(),
    originalLink,
    name: place?.displayName?.text || fallbackName,
    address: place?.formattedAddress || "",
    coordinates: { lat, lng },
    placeId: place?.id,
    status: "resolved",
  };
}

/**
 * Legacy CID / ftid identifiers (0x<hex>:0x<hex>) are not accepted by the
 * Places API (New), so we skip the request instead of spending a billed call
 * on a response we know will fail.
 */
function isLegacyCid(placeId: string): boolean {
  return /^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(placeId);
}

async function resolveByPlaceId(
  placeId: string,
  originalLink: string
): Promise<ResolvedPlace | null> {
  if (isLegacyCid(placeId)) {
    console.log(`[placeId] formato CID não suportado, ignorando: ${placeId}`);
    return null;
  }

  const url = `${PLACES_BASE}/places/${encodeURIComponent(placeId)}`;

  const res = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": PLACE_DETAILS_FIELD_MASK,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  const data = (await res.json()) as NewPlace & NewPlaceError;

  console.log(
    `[placeId] http=${res.status} status=${data.error?.status ?? "OK"} placeId=${placeId}` +
      (data.error ? ` message=${data.error.message ?? "-"} details=${JSON.stringify(data.error.details ?? [])}` : "")
  );

  if (!res.ok || data.error) return null;

  return toResolvedPlace(data, originalLink, "Local desconhecido");
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
  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": PLACE_SEARCH_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: LANGUAGE_CODE,
      regionCode: REGION_CODE,
      maxResultCount: 1,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  const data = (await res.json()) as { places?: NewPlace[] } & NewPlaceError;

  console.log(
    `[textSearch] http=${res.status} status=${data.error?.status ?? "OK"} query="${query}"` +
      (data.error ? ` message=${data.error.message ?? "-"} details=${JSON.stringify(data.error.details ?? [])}` : "")
  );

  if (!res.ok || data.error) return null;

  return toResolvedPlace(data.places?.[0], originalLink, query);
}

/**
 * Forward geocoding fallback using the Geocoding API.
 * Used when the Places API (New) is unavailable or returns no results.
 * Geocodes the address string from the URL path to get coordinates.
 * Uses `displayName` as the place label (e.g. the person/business name).
 */
async function resolveByAddressGeocoding(
  address: string,
  displayName: string,
  originalLink: string
): Promise<ResolvedPlace | null> {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?address=${encodeURIComponent(address)}` +
    `&key=${API_KEY}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const data = await res.json();

  console.log(`[geocodeAddress] status=${data.status} address="${address}"`);

  if (data.status === "OK" && data.results?.[0]) {
    const result = data.results[0];
    return {
      id: crypto.randomUUID(),
      originalLink,
      name: displayName || result.formatted_address?.split(",")[0] || address,
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
