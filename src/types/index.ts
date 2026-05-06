// ──────────────────────────────────────────────
// Core domain types
// ──────────────────────────────────────────────

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface LinkEntry {
  id: string;
  link: string;
  clientName: string;
  empreendimento: string;
}

export interface ResolvedPlace {
  id: string;
  originalLink: string;
  name: string;
  address: string;
  coordinates: Coordinates;
  placeId?: string;
  status: "resolved" | "failed";
  error?: string;
  description?: string;
  clientName?: string;
  empreendimento?: string;
}

export interface UnresolvedLink {
  originalLink: string;
  error: string;
}

export interface ResolveLinksRequest {
  links: string[];
}

export interface ResolveLinksResponse {
  resolved: ResolvedPlace[];
  failed: UnresolvedLink[];
}

export interface OptimizeRouteRequest {
  origin: Coordinates;
  destinations: ResolvedPlace[];
}

export interface OptimizeRouteResponse {
  orderedStops: ResolvedPlace[];
  totalDurationSeconds: number;
  totalDistanceMeters: number;
  legs: RouteLeg[];
  googleMapsUrl: string;
}

export interface RouteLeg {
  from: string;
  to: string;
  durationSeconds: number;
  distanceMeters: number;
}

// ──────────────────────────────────────────────
// App state
// ──────────────────────────────────────────────

export type AppStep =
  | "input"
  | "resolving"
  | "resolved"
  | "optimizing"
  | "optimized";

export interface AppState {
  step: AppStep;
  rawText: string;
  userLocation: Coordinates | null;
  locationAccuracy: number | null;
  locationStatus: "idle" | "loading" | "success" | "error";
  locationError?: string;
  resolvedPlaces: ResolvedPlace[];
  failedLinks: UnresolvedLink[];
  optimizedRoute: OptimizeRouteResponse | null;
  error?: string;
}
