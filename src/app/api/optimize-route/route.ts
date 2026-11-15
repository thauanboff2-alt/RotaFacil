/**
 * API Route: POST /api/optimize-route
 *
 * Receives origin coordinates and list of destinations,
 * optimizes the visit order by travel time, and returns
 * the ordered stops with the final Google Maps URL.
 *
 * Optimization strategy:
 * 1. Use the Google Routes API (`computeRoutes`) with
 *    `optimizeWaypointOrder: true` (supports up to 25 intermediates)
 * 2. If API fails, fall back to nearest-neighbor heuristic
 *    using Haversine distance
 *
 * The route is open-ended: starts at origin, ends at the last
 * optimized stop. No return to origin.
 *
 * NOTE: migrated from the Directions API (Legacy) to the Routes API.
 * Enable "Routes API" in the Google Cloud Console.
 */

import { NextRequest, NextResponse } from "next/server";
import { optimizeRouteRequestSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limiter";
import {
  buildGoogleMapsUrls,
  nearestNeighborOrder,
  deduplicatePlaces,
  haversineDistance,
} from "@/lib/maps-url-builder";
import {
  Coordinates,
  ResolvedPlace,
  OptimizeRouteResponse,
  RouteLeg,
} from "@/types";

const API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

// Routes API endpoint (replaces the legacy Directions API)
const ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

// The Routes API requires an explicit response field mask.
// `routes.optimizedIntermediateWaypointIndex` is mandatory when
// `optimizeWaypointOrder` is true — without it the request fails.
const ROUTES_FIELD_MASK = [
  "routes.optimizedIntermediateWaypointIndex",
  "routes.duration",
  "routes.distanceMeters",
  "routes.legs.duration",
  "routes.legs.distanceMeters",
].join(",");

// Rate limit: 30 optimize requests per minute per IP
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;

// Timeout for the Routes API call
const FETCH_TIMEOUT_MS = 10000;

export async function POST(request: NextRequest) {
  // ── Rate limiting ──────────────────────────
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const rl = checkRateLimit(`optimize:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
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
    const parsed = optimizeRouteRequestSchema.safeParse(body);

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

    const { origin, destinations, returnToOrigin } = parsed.data as {
      origin: Coordinates;
      destinations: ResolvedPlace[];
      returnToOrigin?: boolean;
    };

    // Deduplicate places within 50m
    const { unique } = deduplicatePlaces(destinations);

    if (unique.length === 0) {
      return NextResponse.json(
        { error: "Nenhum destino válido após remoção de duplicatas." },
        { status: 400 }
      );
    }

    // Try Routes API optimization first
    let result = await optimizeWithRoutesApi(origin, unique);

    // Fallback to nearest neighbor if API fails
    if (!result) {
      result = fallbackOptimization(origin, unique);
    }

    // Append origin as last stop if returnToOrigin is requested
    if (returnToOrigin) {
      const originReturn: ResolvedPlace = {
        id: "__origin_return__",
        originalLink: "",
        name: "Ponto de partida",
        address: "",
        coordinates: origin,
        status: "resolved",
      };
      const stopsWithReturn = [...result.orderedStops, originReturn];
      const { urls } = buildGoogleMapsUrls(origin, stopsWithReturn);
      result = {
        ...result,
        orderedStops: stopsWithReturn,
        googleMapsUrl: urls[0] ?? "",
        googleMapsUrls: urls,
      };
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Erro interno. Tente novamente." },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────
// Routes API types (only the fields we request)
// ─────────────────────────────────────────────

interface RoutesApiLeg {
  /** ISO-8601-ish duration string, e.g. "1234s" */
  duration?: string;
  distanceMeters?: number;
}

interface RoutesApiRoute {
  /** Indices into the `intermediates` array, in optimized visit order */
  optimizedIntermediateWaypointIndex?: number[];
  duration?: string;
  distanceMeters?: number;
  legs?: RoutesApiLeg[];
}

interface RoutesApiResponse {
  routes?: RoutesApiRoute[];
  error?: {
    code?: number;
    message?: string;
    status?: string;
    /**
     * Google puts the machine-readable cause here, e.g.
     * { reason: "SERVICE_DISABLED" }        → API não ativada no projeto
     * { reason: "API_KEY_SERVICE_BLOCKED" } → chave restrita, sem esta API
     * { reason: "API_KEY_HTTP_REFERRER_BLOCKED" } → restrição de referenciador
     */
    details?: unknown[];
  };
}

/**
 * Parse a Routes API duration ("1234s") into seconds.
 * Returns 0 when absent or malformed.
 */
function parseDurationSeconds(duration?: string): number {
  if (!duration) return 0;
  const seconds = parseFloat(duration.replace(/s$/, ""));
  return Number.isFinite(seconds) ? Math.round(seconds) : 0;
}

function toWaypoint(coords: Coordinates) {
  return {
    location: {
      latLng: {
        latitude: coords.lat,
        longitude: coords.lng,
      },
    },
  };
}

// ─────────────────────────────────────────────
// Google Routes API optimization
// ─────────────────────────────────────────────

async function optimizeWithRoutesApi(
  origin: Coordinates,
  places: ResolvedPlace[]
): Promise<OptimizeRouteResponse | null> {
  try {
    // Single destination — no optimization needed
    if (places.length === 1) {
      const { urls } = buildGoogleMapsUrls(origin, places);
      return {
        orderedStops: places,
        totalDurationSeconds: 0,
        totalDistanceMeters: 0,
        legs: [],
        googleMapsUrl: urls[0] ?? "",
        googleMapsUrls: urls,
      };
    }

    // Use farthest place (by Haversine) as fixed destination;
    // let the API optimize the order of all other waypoints.
    const farthestIdx = findFarthestIndex(origin, places);
    const destination = places[farthestIdx];
    const intermediatePlaces = places.filter((_, i) => i !== farthestIdx);

    const requestBody = {
      origin: toWaypoint(origin),
      destination: toWaypoint(destination.coordinates),
      intermediates: intermediatePlaces.map((p) => toWaypoint(p.coordinates)),
      travelMode: "DRIVE",
      // Waypoint optimization is incompatible with TRAFFIC_AWARE_OPTIMAL,
      // so routingPreference is intentionally left at its default.
      optimizeWaypointOrder: true,
      languageCode: "pt-BR",
      units: "METRIC",
    };

    const res = await fetch(ROUTES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": ROUTES_FIELD_MASK,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const data = (await res.json()) as RoutesApiResponse;

    if (!res.ok || data.error) {
      console.log(
        `[routes] http=${res.status} status=${data.error?.status ?? "-"} message=${
          data.error?.message ?? "-"
        } details=${JSON.stringify(data.error?.details ?? [])}`
      );
      return null;
    }

    const route = data.routes?.[0];
    if (!route) return null;

    // Reconstruct ordered stops from the API-optimized waypoint order.
    // When there is a single intermediate the API may omit the index array,
    // in which case the original order already is the optimized one.
    const optimizedOrder =
      route.optimizedIntermediateWaypointIndex ??
      intermediatePlaces.map((_, i) => i);

    const orderedStops: ResolvedPlace[] = [];
    for (const idx of optimizedOrder) {
      const place = intermediatePlaces[idx];
      if (place) orderedStops.push(place);
    }

    // Safety net: if the API returned an incomplete order, bail out to the
    // fallback rather than silently dropping stops from the route.
    if (orderedStops.length !== intermediatePlaces.length) {
      console.log(
        `[routes] ordem incompleta: ${orderedStops.length}/${intermediatePlaces.length}`
      );
      return null;
    }

    orderedStops.push(destination);

    // Extract per-leg duration and distance
    const legs: RouteLeg[] = [];
    let totalDuration = 0;
    let totalDistance = 0;

    const stopNames = ["Sua localização", ...orderedStops.map((s) => s.name)];
    const apiLegs = route.legs ?? [];

    for (let i = 0; i < apiLegs.length; i++) {
      const leg = apiLegs[i];
      const durationSeconds = parseDurationSeconds(leg.duration);
      const distanceMeters = leg.distanceMeters ?? 0;

      legs.push({
        from: stopNames[i] ?? "",
        to: stopNames[i + 1] ?? "",
        durationSeconds,
        distanceMeters,
      });
      totalDuration += durationSeconds;
      totalDistance += distanceMeters;
    }

    // Prefer the route-level totals when available (they account for
    // anything not covered by the sum of the legs).
    const routeDuration = parseDurationSeconds(route.duration);
    const routeDistance = route.distanceMeters ?? 0;

    const { urls } = buildGoogleMapsUrls(origin, orderedStops);

    return {
      orderedStops,
      totalDurationSeconds: routeDuration || totalDuration,
      totalDistanceMeters: routeDistance || totalDistance,
      legs,
      googleMapsUrl: urls[0] ?? "",
      googleMapsUrls: urls,
    };
  } catch {
    return null;
  }
}

/**
 * Find the index of the place farthest from the origin using Haversine distance.
 * More accurate than Euclidean across large geographic areas.
 */
function findFarthestIndex(origin: Coordinates, places: ResolvedPlace[]): number {
  let maxDist = -1;
  let maxIdx = 0;
  for (let i = 0; i < places.length; i++) {
    const d = haversineDistance(origin, places[i].coordinates);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  return maxIdx;
}

// ─────────────────────────────────────────────
// Fallback: Nearest neighbor optimization
// ─────────────────────────────────────────────

function fallbackOptimization(
  origin: Coordinates,
  places: ResolvedPlace[]
): OptimizeRouteResponse {
  const order = nearestNeighborOrder(origin, places);
  const orderedStops = order.map((i) => places[i]);
  const { urls } = buildGoogleMapsUrls(origin, orderedStops);

  return {
    orderedStops,
    totalDurationSeconds: 0,
    totalDistanceMeters: 0,
    legs: [],
    googleMapsUrl: urls[0] ?? "",
    googleMapsUrls: urls,
  };
}
