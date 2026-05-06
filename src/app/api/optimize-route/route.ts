/**
 * API Route: POST /api/optimize-route
 *
 * Receives origin coordinates and list of destinations,
 * optimizes the visit order by travel time, and returns
 * the ordered stops with the final Google Maps URL.
 *
 * Optimization strategy:
 * 1. Use Google Directions API with `optimizeWaypoints=true`
 *    (supports up to 25 waypoints per request)
 * 2. If API fails, fall back to nearest-neighbor heuristic
 *    using Haversine distance
 *
 * The route is open-ended: starts at origin, ends at the last
 * optimized stop. No return to origin.
 */

import { NextRequest, NextResponse } from "next/server";
import { optimizeRouteRequestSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limiter";
import {
  buildGoogleMapsUrl,
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

// Rate limit: 30 optimize requests per minute per IP
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;

// Timeout for Directions API call
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

    const { origin, destinations } = parsed.data as {
      origin: Coordinates;
      destinations: ResolvedPlace[];
    };

    // Deduplicate places within 50m
    const { unique } = deduplicatePlaces(destinations);

    if (unique.length === 0) {
      return NextResponse.json(
        { error: "Nenhum destino válido após remoção de duplicatas." },
        { status: 400 }
      );
    }

    // Try Google Directions API optimization first
    let result = await optimizeWithDirectionsApi(origin, unique);

    // Fallback to nearest neighbor if API fails
    if (!result) {
      result = fallbackOptimization(origin, unique);
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
// Google Directions API optimization
// ─────────────────────────────────────────────

async function optimizeWithDirectionsApi(
  origin: Coordinates,
  places: ResolvedPlace[]
): Promise<OptimizeRouteResponse | null> {
  try {
    // Single destination — no optimization needed
    if (places.length === 1) {
      const urlResult = buildGoogleMapsUrl(origin, places);
      return {
        orderedStops: places,
        totalDurationSeconds: 0,
        totalDistanceMeters: 0,
        legs: [],
        googleMapsUrl: urlResult.url,
      };
    }

    const originStr = `${origin.lat},${origin.lng}`;

    // Use farthest place (by Haversine) as fixed destination;
    // let the API optimize the order of all other waypoints.
    const farthestIdx = findFarthestIndex(origin, places);
    const destination = places[farthestIdx];
    const waypoints = places.filter((_, i) => i !== farthestIdx);

    let apiUrl =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${originStr}` +
      `&destination=${destination.coordinates.lat},${destination.coordinates.lng}` +
      `&travelmode=driving` +
      `&key=${API_KEY}`;

    if (waypoints.length > 0) {
      const wpStr = waypoints
        .map((p) => `${p.coordinates.lat},${p.coordinates.lng}`)
        .join("|");
      apiUrl += `&waypoints=optimize:true|${wpStr}`;
    }

    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const data = await res.json();

    if (data.status !== "OK" || !data.routes?.[0]) {
      return null;
    }

    const route = data.routes[0];
    const waypointOrder: number[] = route.waypoint_order || [];

    // Reconstruct ordered stops from API-optimized waypoint order
    const orderedStops: ResolvedPlace[] = [];
    for (const idx of waypointOrder) {
      orderedStops.push(waypoints[idx]);
    }
    orderedStops.push(destination);

    // Extract per-leg duration and distance
    const legs: RouteLeg[] = [];
    let totalDuration = 0;
    let totalDistance = 0;

    const stopNames = ["Sua localização", ...orderedStops.map((s) => s.name)];

    for (let i = 0; i < route.legs.length; i++) {
      const leg = route.legs[i];
      legs.push({
        from: stopNames[i],
        to: stopNames[i + 1],
        durationSeconds: leg.duration.value,
        distanceMeters: leg.distance.value,
      });
      totalDuration += leg.duration.value;
      totalDistance += leg.distance.value;
    }

    const urlResult = buildGoogleMapsUrl(origin, orderedStops);

    return {
      orderedStops,
      totalDurationSeconds: totalDuration,
      totalDistanceMeters: totalDistance,
      legs,
      googleMapsUrl: urlResult.url,
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
  const urlResult = buildGoogleMapsUrl(origin, orderedStops);

  return {
    orderedStops,
    totalDurationSeconds: 0,
    totalDistanceMeters: 0,
    legs: [],
    googleMapsUrl: urlResult.url,
  };
}
