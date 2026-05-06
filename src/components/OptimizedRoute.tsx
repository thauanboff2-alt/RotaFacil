"use client";

import { useState } from "react";
import { OptimizeRouteResponse, Coordinates } from "@/types";

interface OptimizedRouteProps {
  route: OptimizeRouteResponse;
  origin: Coordinates;
}

export default function OptimizedRoute({ route, origin }: OptimizedRouteProps) {
  const [copied, setCopied] = useState(false);

  const openRoute = () => {
    window.open(route.googleMapsUrl, "_blank", "noopener");
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(route.googleMapsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const input = document.createElement("input");
      input.value = route.googleMapsUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const totalMinutes = Math.round(route.totalDurationSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const totalKm = (route.totalDistanceMeters / 1000).toFixed(1);

  return (
    <section className="space-y-5 animate-slide-up">
      {/* Summary header */}
      <div className="bg-gradient-to-br from-accent/10 to-accent-dark/5 border border-accent/20 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e07a3a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <h3 className="font-display text-lg">Rota otimizada</h3>
        </div>

        {/* Stats */}
        {route.totalDurationSeconds > 0 && (
          <div className="flex gap-6">
            <div>
              <p className="text-xs text-surface-300/60 uppercase tracking-wider">Tempo total</p>
              <p className="text-xl font-display text-accent mt-0.5">
                {hours > 0 && `${hours}h `}
                {minutes}min
              </p>
            </div>
            <div>
              <p className="text-xs text-surface-300/60 uppercase tracking-wider">Distância</p>
              <p className="text-xl font-display text-surface-100 mt-0.5">
                {totalKm} km
              </p>
            </div>
            <div>
              <p className="text-xs text-surface-300/60 uppercase tracking-wider">Paradas</p>
              <p className="text-xl font-display text-surface-100 mt-0.5">
                {route.orderedStops.length}
              </p>
            </div>
          </div>
        )}

        {/* CTA button */}
        <button
          onClick={openRoute}
          className="w-full py-4 rounded-xl font-bold text-base tracking-wide bg-gradient-to-r from-accent to-accent-dark text-surface-950 hover:shadow-xl hover:shadow-accent/25 transition-all duration-300 flex items-center justify-center gap-2"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          Abrir rota no Google Maps
        </button>

        {/* Secondary: copy link */}
        <button
          onClick={copyLink}
          className="w-full py-2.5 rounded-lg text-sm text-surface-300 hover:text-accent border border-surface-800/60 hover:border-accent/30 transition-all flex items-center justify-center gap-2"
        >
          {copied ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5a9a6e" strokeWidth="2.5">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              Link copiado!
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              Copiar link da rota
            </>
          )}
        </button>
      </div>

      {/* Route steps */}
      <div className="space-y-1">
        <h4 className="text-xs font-medium text-surface-300/60 uppercase tracking-widest mb-3">
          Sequência otimizada
        </h4>

        {/* Origin */}
        <div className="flex items-start gap-3 pl-1 step-line">
          <div className="w-8 h-8 rounded-full bg-info/20 flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4a8ec4" strokeWidth="2.5">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </div>
          <div className="pt-1.5">
            <p className="text-sm font-medium text-info">Sua localização</p>
            <p className="text-[10px] font-mono text-surface-300/30">
              {origin.lat.toFixed(6)}, {origin.lng.toFixed(6)}
            </p>
          </div>
        </div>

        {/* Stops */}
        {route.orderedStops.map((stop, index) => {
          const leg = route.legs[index];
          const isLast = index === route.orderedStops.length - 1;

          return (
            <div key={stop.id}>
              {/* Leg info */}
              {leg && (
                <div className="ml-4 pl-7 py-1.5 flex items-center gap-2 text-[10px] text-surface-300/40">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12l7 7 7-7" />
                  </svg>
                  {Math.round(leg.durationSeconds / 60)} min
                  {" · "}
                  {(leg.distanceMeters / 1000).toFixed(1)} km
                </div>
              )}

              {/* Stop card */}
              <div
                className={`flex items-start gap-3 pl-1 ${
                  !isLast ? "step-line" : ""
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                    isLast
                      ? "bg-accent/20 text-accent"
                      : "bg-surface-800 text-surface-300"
                  }`}
                >
                  {index + 1}
                </div>
                <div className="pt-1 flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{stop.name}</p>
                  {(stop.clientName || stop.empreendimento) && (
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {stop.clientName && (
                        <span className="text-xs text-accent/80 font-medium">
                          {stop.clientName}
                        </span>
                      )}
                      {stop.clientName && stop.empreendimento && (
                        <span className="text-surface-300/30 text-xs">·</span>
                      )}
                      {stop.empreendimento && (
                        <span className="text-xs text-surface-300/60">
                          {stop.empreendimento}
                        </span>
                      )}
                    </div>
                  )}
                  {stop.address && (
                    <p className="text-xs text-surface-300/50 truncate mt-0.5">
                      {stop.address}
                    </p>
                  )}
                  {stop.description && (
                    <p className="text-xs text-accent/70 italic mt-1 truncate">
                      {stop.description}
                    </p>
                  )}
                  {isLast && (
                    <span className="inline-block mt-1 text-[10px] font-medium text-accent bg-accent/10 px-2 py-0.5 rounded-full">
                      Destino final
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Link preview */}
      <div className="bg-surface-900/40 border border-surface-800/40 rounded-xl p-3 space-y-2">
        <p className="text-[10px] uppercase tracking-widest text-surface-300/40 font-medium">
          URL da rota
        </p>
        <p className="text-xs font-mono text-surface-300/60 break-all leading-relaxed select-all">
          {route.googleMapsUrl}
        </p>
      </div>

      {/* Route list: name + empreendimento */}
      {route.orderedStops.some((s) => s.clientName || s.empreendimento) && (
        <div className="bg-surface-900/40 border border-surface-800/40 rounded-xl p-4 space-y-3">
          <p className="text-[10px] uppercase tracking-widest text-surface-300/40 font-medium">
            Lista da rota
          </p>
          <div className="space-y-2">
            {route.orderedStops.map((stop, index) => (
              <div key={stop.id} className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-md bg-surface-800 text-surface-300/60 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  {stop.clientName && (
                    <p className="text-sm font-medium text-surface-100">
                      {stop.clientName}
                    </p>
                  )}
                  {stop.empreendimento && (
                    <p className="text-xs text-surface-300/60 mt-0.5">
                      {stop.empreendimento}
                    </p>
                  )}
                  {!stop.clientName && !stop.empreendimento && (
                    <p className="text-sm text-surface-300/50 italic">{stop.name}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
