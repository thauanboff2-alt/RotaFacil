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
  returnToOrigin: false,
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
  const optimizeRouteWithLocation = useCallback(async (location: Coordinates, places: ResolvedPlace[], returnToOrigin: boolean) => {
    setOptimizing(true);
    setState((s) => ({ ...s, step: "optimizing", error: undefined }));

    try {
      const res = await fetch("/api/optimize-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: location,
          destinations: places,
          returnToOrigin,
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
  }, []);

  const optimizeRoute = useCallback(async () => {
    if (!state.userLocation) {
      setState((s) => ({ ...s, error: "Ative a localização antes de otimizar a rota." }));
      return;
    }
    if (state.resolvedPlaces.length === 0) {
      setState((s) => ({ ...s, error: "Nenhum local resolvido para otimizar." }));
      return;
    }
    await optimizeRouteWithLocation(state.userLocation, state.resolvedPlaces, state.returnToOrigin);
  }, [state.userLocation, state.resolvedPlaces, state.returnToOrigin, optimizeRouteWithLocation]);

  // ── Recalculate route from new location ────
  const recalculateRoute = useCallback(() => {
    if (!navigator.geolocation) return;
    setState((s) => ({ ...s, locationStatus: "loading", error: undefined }));

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const newLocation: Coordinates = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setState((s) => ({
          ...s,
          userLocation: newLocation,
          locationAccuracy: pos.coords.accuracy ?? null,
          locationStatus: "success",
        }));
        optimizeRouteWithLocation(newLocation, state.resolvedPlaces, state.returnToOrigin);
      },
      () => {
        setState((s) => ({
          ...s,
          locationStatus: "error",
          locationError: "Não foi possível atualizar a localização.",
          step: "optimized",
        }));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, [state.resolvedPlaces, state.returnToOrigin, optimizeRouteWithLocation]);

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
      <header className="border-b border-accent/10 backdrop-blur-sm sticky top-0 z-50 bg-surface-950/90">
        <div className="max-w-3xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-accent-dark flex items-center justify-center shadow-sm shadow-accent/30">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
            </div>
            <div>
              <h1 className="font-display text-base tracking-tight leading-none">RotaFácil</h1>
              <p className="text-[10px] text-accent/60 tracking-wide leading-none mt-0.5">Fiscais &amp; Peritos</p>
            </div>
          </div>
          {state.step !== "input" && (
            <button
              onClick={reset}
              className="text-xs text-surface-300/60 hover:text-accent transition-colors border border-surface-800/40 hover:border-accent/30 px-3 py-1.5 rounded-lg"
            >
              Nova rota
            </button>
          )}
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {/* Hero / Entrada */}
        <section className="animate-fade-in">
          {/* Destaque institucional */}
          <div className="relative overflow-hidden rounded-2xl border border-accent/20 bg-gradient-to-br from-surface-900 via-surface-900/95 to-surface-800/80 px-6 py-8 mb-6 text-center">
            {/* Decoração de fundo */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-accent/5" />
              <div className="absolute -bottom-10 -left-10 w-36 h-36 rounded-full bg-lime/5" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-px bg-gradient-to-r from-transparent via-accent/10 to-transparent" />
            </div>

            {/* Ícone */}
            <div className="relative flex justify-center mb-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent to-accent-dark flex items-center justify-center shadow-lg shadow-accent/20">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                  <circle cx="12" cy="9" r="2.5" />
                </svg>
              </div>
            </div>

            {/* Frase de destaque */}
            <div className="relative space-y-2">
              <p className="text-xs font-semibold tracking-[0.2em] uppercase text-accent/70">
                RotaFácil
              </p>
              <h2 className="font-display text-2xl sm:text-3xl tracking-tight text-white leading-snug">
                Sua rota ainda mais{" "}
                <span className="text-accent">fácil</span>
              </h2>
              <p className="text-sm font-medium text-surface-300/80 max-w-xs mx-auto leading-relaxed pt-1">
                Aplicativo destinado a{" "}
                <span className="text-lime font-semibold">Fiscais</span>
                {" "}e{" "}
                <span className="text-lime font-semibold">Peritos</span>
              </p>
            </div>

            {/* Linha decorativa */}
            <div className="relative mt-5 flex items-center gap-3 justify-center">
              <div className="h-px w-12 bg-gradient-to-r from-transparent to-accent/30" />
              <div className="flex gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-accent/50" />
                <div className="w-1.5 h-1.5 rounded-full bg-lime/50" />
                <div className="w-1.5 h-1.5 rounded-full bg-info/50" />
              </div>
              <div className="h-px w-12 bg-gradient-to-l from-transparent to-accent/30" />
            </div>

            {/* Sub-instrução */}
            <p className="relative mt-4 text-xs text-surface-300/50 max-w-sm mx-auto leading-relaxed">
              Cole os links do Google Maps da conversa do WhatsApp. O sistema detecta automaticamente locais, nomes e empreendimentos.
            </p>
          </div>
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

              {/* Return to origin toggle */}
              <label className="flex items-center gap-3 px-4 py-3 rounded-xl border border-surface-800/60 bg-surface-900/40 cursor-pointer hover:border-accent/30 transition-colors">
                <div className="relative flex-shrink-0">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={state.returnToOrigin}
                    onChange={(e) => setState((s) => ({ ...s, returnToOrigin: e.target.checked }))}
                  />
                  <div className={`w-10 h-6 rounded-full transition-colors ${state.returnToOrigin ? "bg-accent" : "bg-surface-700"}`}>
                    <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${state.returnToOrigin ? "translate-x-5" : "translate-x-1"}`} />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-surface-100">Retornar ao ponto de partida</p>
                  <p className="text-xs text-surface-300/50 mt-0.5">A rota termina no seu local de saída</p>
                </div>
              </label>

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
            returnToOrigin={state.returnToOrigin}
            onRecalculate={recalculateRoute}
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
