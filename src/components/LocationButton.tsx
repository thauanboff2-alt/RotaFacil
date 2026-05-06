"use client";

import { Coordinates } from "@/types";

interface LocationButtonProps {
  status: "idle" | "loading" | "success" | "error";
  location: Coordinates | null;
  accuracy?: number | null;
  error?: string;
  onRequest: () => void;
}

export default function LocationButton({
  status,
  location,
  accuracy,
  error,
  onRequest,
}: LocationButtonProps) {
  return (
    <div className="animate-slide-up">
      {status === "success" && location ? (
        <div className="flex items-center gap-3 bg-success/10 border border-success/20 rounded-xl px-4 py-3">
          <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5a9a6e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-success">
              Localização capturada
              {accuracy !== null && accuracy !== undefined && (
                <span className={`ml-2 text-xs font-normal px-1.5 py-0.5 rounded-full ${accuracy <= 20 ? "bg-success/20 text-success" : accuracy <= 100 ? "bg-info/20 text-info" : "bg-danger/20 text-danger"}`}>
                  ~{Math.round(accuracy)}m
                </span>
              )}
            </p>
            <p className="text-xs text-surface-300 font-mono truncate">
              {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
            </p>
          </div>
          <button
            onClick={onRequest}
            className="text-xs text-surface-300 hover:text-accent transition-colors"
          >
            Atualizar
          </button>
        </div>
      ) : (
        <button
          onClick={onRequest}
          disabled={status === "loading"}
          className={`w-full flex items-center gap-3 rounded-xl px-4 py-3.5 transition-all duration-200 border ${
            status === "error"
              ? "bg-danger/10 border-danger/20"
              : "bg-surface-900/60 border-surface-800/60 hover:border-accent/30 hover:bg-surface-900/80"
          } ${status === "idle" ? "loc-pulse" : ""}`}
        >
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
              status === "loading"
                ? "bg-accent/20"
                : status === "error"
                ? "bg-danger/20"
                : "bg-accent/10"
            }`}
          >
            {status === "loading" ? (
              <svg className="animate-spin h-4 w-4 text-accent" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="60" strokeDashoffset="20" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={status === "error" ? "#c44a4a" : "#e07a3a"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
              </svg>
            )}
          </div>
          <div className="text-left flex-1">
            <p className="text-sm font-medium">
              {status === "loading"
                ? "Obtendo localização…"
                : status === "error"
                ? "Erro na localização"
                : "Usar minha localização atual"}
            </p>
            {status === "error" && error && (
              <p className="text-xs text-danger/80 mt-0.5">{error}</p>
            )}
            {status === "idle" && (
              <p className="text-xs text-surface-300/60">
                Necessário para definir a origem da rota
              </p>
            )}
          </div>
        </button>
      )}
    </div>
  );
}
