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
 * - Google Maps URL supports up to ~23 waypoints in practice (URL length limit ~2048 chars)
 * - The `optimize:true` waypoint flag is NOT supported in the URL scheme (only in Directions API)
 * - place_id can be used with `destination_place_id` param but waypoints only support coords/addresses
 */

import { Coordinates, ResolvedPlace } from "@/types";

const MAPS_BASE = "https://www.google.com/maps/dir/";
const MAX_WAYPOINTS_IN_URL = 23;

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
  if (orderedStops.length === 0) {
    return {
      url: `${MAPS_BASE}?api=1`,
      waypointCount: 0,
      truncated: false,
      warning: "Nenhuma parada fornecida.",
    };
  }

  const destination = orderedStops[orderedStops.length - 1];
  const waypoints = orderedStops.slice(0, -1);

  const truncated = waypoints.length > MAX_WAYPOINTS_IN_URL;
  const effectiveWaypoints = waypoints.slice(0, MAX_WAYPOINTS_IN_URL);

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

  if (effectiveWaypoints.length > 0) {
    const waypointStr = effectiveWaypoints
      .map((p) => `${p.coordinates.lat},${p.coordinates.lng}`)
      .join("|");
    params.set("waypoints", waypointStr);
  }

  const url = `${MAPS_BASE}?${params.toString()}`;

  return {
    url,
    waypointCount: effectiveWaypoints.length,
    truncated,
    warning: truncated
      ? `O Google Maps suporta até ${MAX_WAYPOINTS_IN_URL} paradas intermediárias. ${waypoints.length - MAX_WAYPOINTS_IN_URL} paradas foram removidas.`
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
