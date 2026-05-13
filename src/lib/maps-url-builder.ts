/**
 * Google Maps URL Builder
 *
 * Builds the final navigation URL using the official Google Maps URL scheme.
 *
 * Format:
 *   https://www.google.com/maps/dir/?api=1
 *     &origin=lat,lng
 *     &destination=lat,lng
 *     &waypoints=lat1,lng1|lat2,lng2|...
 *     &travelmode=driving
 *
 * Limitations:
 * - Google Maps consumer app supports up to 10 stops per route link
 * - When there are more than 10 stops, multiple links are generated
 * - Each subsequent link starts from the last stop of the previous link
 * - The `optimize:true` waypoint flag is NOT supported in the URL scheme (only in Directions API)
 * - place_id can be used with `destination_place_id` param but waypoints only support coords/addresses
 */

import { Coordinates, ResolvedPlace } from "@/types";

const MAPS_BASE = "https://www.google.com/maps/dir/";
export const MAX_STOPS_PER_LINK = 10;

export interface BuildUrlsResult {
  urls: string[];
  chunks: number;
}

/**
 * Build a single Google Maps URL for a given origin and list of stops.
 * Assumes stops.length <= MAX_STOPS_PER_LINK.
 */
function buildSingleUrl(origin: Coordinates, stops: ResolvedPlace[]): string {
  if (stops.length === 0) return `${MAPS_BASE}?api=1`;

  const destination = stops[stops.length - 1];
  const waypoints = stops.slice(0, -1);

  const params = new URLSearchParams();
  params.set("api", "1");
  params.set("origin", `${origin.lat},${origin.lng}`);
  params.set(
    "destination",
    `${destination.coordinates.lat},${destination.coordinates.lng}`
  );
  if (destination.placeId) {
    params.set("destination_place_id", destination.placeId);
  }
  params.set("travelmode", "driving");

  if (waypoints.length > 0) {
    const waypointStr = waypoints
      .map((p) => `${p.coordinates.lat},${p.coordinates.lng}`)
      .join("|");
    params.set("waypoints", waypointStr);
  }

  return `${MAPS_BASE}?${params.toString()}`;
}

/**
 * Build one or more Google Maps URLs for the full ordered route.
 *
 * Splits stops into chunks of MAX_STOPS_PER_LINK. Each chunk after the first
 * uses the last stop of the previous chunk as its origin, ensuring continuity.
 *
 * Example (22 stops → 3 links):
 *   Link 1: origin=userLoc,  stops 1-10
 *   Link 2: origin=stop 10,  stops 11-20
 *   Link 3: origin=stop 20,  stops 21-22
 */
export function buildGoogleMapsUrls(
  origin: Coordinates,
  orderedStops: ResolvedPlace[]
): BuildUrlsResult {
  if (orderedStops.length === 0) return { urls: [], chunks: 0 };

  const urls: string[] = [];

  for (let i = 0; i < orderedStops.length; i += MAX_STOPS_PER_LINK) {
    const chunk = orderedStops.slice(i, i + MAX_STOPS_PER_LINK);
    const chunkOrigin =
      i === 0 ? origin : orderedStops[i - 1].coordinates;
    urls.push(buildSingleUrl(chunkOrigin, chunk));
  }

  return { urls, chunks: urls.length };
}

/**
 * @deprecated Use buildGoogleMapsUrls instead.
 * Kept for any legacy callers; returns only the first URL.
 */
export interface BuildUrlResult {
  url: string;
  waypointCount: number;
  truncated: boolean;
  warning?: string;
}

export function buildGoogleMapsUrl(
  origin: Coordinates,
  orderedStops: ResolvedPlace[]
): BuildUrlResult {
  const { urls } = buildGoogleMapsUrls(origin, orderedStops);
  const url = urls[0] ?? `${MAPS_BASE}?api=1`;
  const truncated = orderedStops.length > MAX_STOPS_PER_LINK;
  return {
    url,
    waypointCount: Math.min(orderedStops.length - 1, MAX_STOPS_PER_LINK - 1),
    truncated,
    warning: truncated
      ? `Rota dividida em ${urls.length} links (${MAX_STOPS_PER_LINK} paradas por link).`
      : undefined,
  };
}

/**
 * Calculate distance between two coordinates using the Haversine formula (meters).
 */
export function haversineDistance(a: Coordinates, b: Coordinates): number {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const calc =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(calc), Math.sqrt(1 - calc));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Nearest neighbor heuristic for route optimization (fallback when API is not available).
 * Returns indices in optimized order.
 */
export function nearestNeighborOrder(
  origin: Coordinates,
  places: ResolvedPlace[]
): number[] {
  const n = places.length;
  const visited = new Array(n).fill(false);
  const order: number[] = [];
  let current = origin;

  for (let step = 0; step < n; step++) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      const d = haversineDistance(current, places[i].coordinates);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    visited[bestIdx] = true;
    order.push(bestIdx);
    current = places[bestIdx].coordinates;
  }

  return order;
}

/**
 * Deduplication: remove places within a threshold distance (default 50m).
 */
export function deduplicatePlaces(
  places: ResolvedPlace[],
  thresholdMeters: number = 50
): { unique: ResolvedPlace[]; duplicates: ResolvedPlace[] } {
  const unique: ResolvedPlace[] = [];
  const duplicates: ResolvedPlace[] = [];

  for (const place of places) {
    const isDup = unique.some(
      (u) => haversineDistance(u.coordinates, place.coordinates) < thresholdMeters
    );
    if (isDup) {
      duplicates.push(place);
    } else {
      unique.push(place);
    }
  }

  return { unique, duplicates };
}
