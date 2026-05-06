"use client";

import { useState, useCallback, useMemo } from "react";
import {
  AppState,
  ResolvedPlace,
  UnresolvedLink,
  OptimizeRouteResponse,
  Coordinates,
} from "@/types";
import { parseEntriesFromText } from "@/lib/link-parser";
import LinkInput from "@/components/LinkInput";
import LocationButton from "@/components/LocationButton";
import PlaceCards from "@/components/PlaceCards";
import OptimizedRoute from "@/components/OptimizedRoute";
import FailedLinks from "@/components/FailedLinks";
import StepIndicator from "@/components/StepIndicator";

const initialState: AppState = {
  step: "input",
  rawText: "",
  userLocation: null,
  locationAccuracy: null,
  locationStatus: "idle",
  resolvedPlaces: [],
  failedLinks: [],
  optimizedRoute: null,
};

export default function Home() {
  const [state, setState] = useState<AppState>(initialState);
  const [resolving, setResolving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);

  // Auto-parse entries from raw text
  const parsedEntries = useMemo(
    () => parseEntriesFromText(state.rawText),
    [state.rawText]
  );

  // ── Location ───────────────────────────────
  const requestLocation = useCallback(() => {
    setState((s) => ({ ...s, locationStatus: "loading", locationError: undefined }));

    if (!navigator.geolocation) {
      setState((s) => ({
        ...s,
        locationStatus: "error",
        locationError: "Geolocalização não suportada neste navegador.",
      }));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState((s) => ({
          ...s,
          userLocation: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          locationAccuracy: pos.coords.accuracy ?? null,
          locationStatus: "success",
        }));
      },
      (err) => {
        setState((s) => ({
          ...s,
          locationStatus: "error",
          locationError:
            err.code === 1
              ? "Permissão negada. Ative a localização nas configurações do navegador."
              : err.code === 2
              ? "Localização indisponível. Verifique o GPS ou conexão."
              : "Tempo esgotado ao obter localização. Tente novamente.",
        }));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  // ── Resolve links ──────────────────────────
  const resolveLinks = useCallback(async () => {
    const entries = parseEntriesFromText(state.rawText);
    if (entries.length === 0) {
      setState((s) => ({
        ...s,
        error: "Nenhum link do Google Maps encontrado. Cole a conversa com os links.",
      }));
      return;
    }

    setResolving(true);
    setState((s) => ({ ...s, step: "resolving", error: undefined }));

    try {
      const links = entries.map((e) => e.link);

      const res = await fetch("/api/resolve-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao resolver links");
      }

      const data: { resolved: ResolvedPlace[]; failed: UnresolvedLink[] } =
        await res.json();

      // Attach clientName and empreendimento by matching original link
      const enriched = data.resolved.map((place) => {
        const entry = entries.find((e) => e.link === place.originalLink);
        return {
          ...place,
          clientName: entry?.clientName?.trim() || undefined,
          empreendimento: entry?.empreendimento?.trim() || undefined,
        };
      });

      setState((s) => ({
        ...s,
        step: "resolved",
        resolvedPlaces: enriched,
        failedLinks: data.failed,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        step: "input",
        error: err instanceof Error ? err.message : "Erro desconhecido",
      }));
    } finally {
      setResolving(false);
    }
  }, [state.rawText]);

  // ── Optimize route ─────────────────────────
  const optimizeRoute = useCallback(async () => {
    if (!state.userLocation) {
      setState((s) => ({ ...s, error: "Ative a localização antes de otimizar a rota." }));
      return;
    }
    if (state.resolvedPlaces.length === 0) {
      setState((s) => ({ ...s, error: "Nenhum local resolvido para otimizar." }));
      return;
    }

    setOptimizing(true);
    setState((s) => ({ ...s, step: "optimizing", error: undefined }));

    try {
      const res = await fetch("/api/optimize-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: state.userLocation,
          destinations: state.resolvedPlaces,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao otimizar rota");
      }

      const data: OptimizeRouteResponse = await res.json();

      setState((s) => ({
        ...s,
        step: "optimized",
        optimizedRoute: data,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        step: "resolved",
        error: err instanceof Error ? err.message : "Erro desconhecido",
      }));
    } finally {
      setOptimizing(false);
    }
  }, [state.userLocation, state.resolvedPlaces]);

  // ── Remove place ───────────────────────────
  const removePlace = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      resolvedPlaces: s.resolvedPlaces.filter((p) => p.id !== id),
    }));
  }, []);

  // ── Update description ─────────────────────
  const updateDescription = useCallback((id: string, description: string) => {
    setState((s) => ({
      ...s,
      resolvedPlaces: s.resolvedPlaces.map((p) =>
        p.id === id ? { ...p, description } : p
      ),
    }));
  }, []);

  // ── Reset ──────────────────────────────────
  const reset = useCallback(() => {
    setState({
      ...initialState,
      userLocation: state.userLocation,
      locationAccuracy: state.locationAccuracy,
      locationStatus: state.locationStatus,
    });
  }, [state.userLocation, state.locationAccuracy, state.locationStatus]);

  return (
    <main className="hero-gradient min-h-screen">
      {/* Header */}
      <header className="border-b border-surface-800/60 backdrop-blur-sm sticky top-0 z-50 bg-surface-950/80">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent to-accent-dark flex items-center justify-center">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-surface-950"
              >
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
            </div>
            <h1 className="font-display text-xl tracking-tight">RotaFácil</h1>
          </div>
          {state.step !== "input" && (
            <button
              onClick={reset}
              className="text-sm text-surface-300 hover:text-accent transition-colors"
            >
              Nova rota
            </button>
          )}
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {/* Hero */}
        <section className="text-center space-y-3 animate-fade-in">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Otimize sua rota
            <span className="text-accent"> em segundos</span>
          </h2>
          <p className="text-surface-300 text-base max-w-lg mx-auto leading-relaxed">
            Cole a conversa do WhatsApp. O sistema detecta automaticamente os links,
            nomes e empreendimentos.
          </p>
        </section>

        {/* Step indicator */}
        <StepIndicator currentStep={state.step} />

        {/* Error message */}
        {state.error && (
          <div className="bg-danger/10 border border-danger/30 text-danger rounded-xl px-4 py-3 text-sm animate-fade-in">
            {state.error}
          </div>
        )}

        {/* Location */}
        <LocationButton
          status={state.locationStatus}
          location={state.userLocation}
          accuracy={state.locationAccuracy}
          error={state.locationError}
          onRequest={requestLocation}
        />

        {/* Link input */}
        {(state.step === "input" || state.step === "resolving") && (
          <section className="space-y-4 animate-slide-up" style={{ animationDelay: "0.1s" }}>
            <LinkInput
              value={state.rawText}
              onChange={(v) => setState((s) => ({ ...s, rawText: v, error: undefined }))}
              detectedEntries={parsedEntries}
            />

            <button
              onClick={resolveLinks}
              disabled={resolving || parsedEntries.length === 0}
              className="w-full py-3.5 rounded-xl font-semibold text-sm tracking-wide transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed bg-surface-800 hover:bg-surface-800/80 text-surface-100 border border-surface-200/10 hover:border-accent/30"
            >
              {resolving ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner /> Resolvendo {parsedEntries.length} {parsedEntries.length === 1 ? "local" : "locais"}…
                </span>
              ) : parsedEntries.length > 0 ? (
                `Validar ${parsedEntries.length} ${parsedEntries.length === 1 ? "local" : "locais"}`
              ) : (
                "Cole uma conversa para começar"
              )}
            </button>
          </section>
        )}

        {/* Resolved places */}
        {state.resolvedPlaces.length > 0 &&
          (state.step === "resolved" || state.step === "optimizing") && (
            <section className="space-y-4 animate-slide-up">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg">
                  {state.resolvedPlaces.length}{" "}
                  {state.resolvedPlaces.length === 1 ? "local encontrado" : "locais encontrados"}
                </h3>
              </div>

              <PlaceCards
                places={state.resolvedPlaces}
                onRemove={removePlace}
                onDescriptionChange={updateDescription}
              />

              <button
                onClick={optimizeRoute}
                disabled={
                  optimizing ||
                  state.resolvedPlaces.length === 0 ||
                  state.locationStatus !== "success"
                }
                className="w-full py-3.5 rounded-xl font-semibold text-sm tracking-wide transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-accent to-accent-dark text-surface-950 hover:shadow-lg hover:shadow-accent/20"
              >
                {optimizing ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner /> Otimizando rota…
                  </span>
                ) : (
                  `Otimizar rota com ${state.resolvedPlaces.length} paradas`
                )}
              </button>
            </section>
          )}

        {/* Failed links */}
        {state.failedLinks.length > 0 && state.step !== "input" && (
          <FailedLinks links={state.failedLinks} />
        )}

        {/* Optimized route result */}
        {state.optimizedRoute && state.step === "optimized" && (
          <OptimizedRoute
            route={state.optimizedRoute}
            origin={state.userLocation!}
          />
        )}

        {/* Footer */}
        <footer className="text-center text-xs text-surface-300/40 pt-8 pb-4 space-y-1">
          <p>RotaFácil — MVP v1.0</p>
          <p>Limite prático: ~23 waypoints por URL do Google Maps</p>
        </footer>
      </div>
    </main>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeDasharray="60"
        strokeDashoffset="20"
        strokeLinecap="round"
      />
    </svg>
  );
}
