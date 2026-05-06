"use client";

import { ResolvedPlace } from "@/types";

interface PlaceCardsProps {
  places: ResolvedPlace[];
  onRemove: (id: string) => void;
  onDescriptionChange?: (id: string, description: string) => void;
  ordered?: boolean;
}

export default function PlaceCards({
  places,
  onRemove,
  onDescriptionChange,
  ordered,
}: PlaceCardsProps) {
  return (
    <div className="space-y-2">
      {places.map((place, index) => (
        <div
          key={place.id}
          className="group bg-surface-900/60 border border-surface-800/60 rounded-xl px-4 py-3 hover:border-surface-200/10 transition-colors animate-fade-in"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <div className="flex items-start gap-3">
            {/* Number badge */}
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5 ${
                ordered
                  ? "bg-accent/20 text-accent"
                  : "bg-surface-800 text-surface-300"
              }`}
            >
              {index + 1}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-surface-100 truncate">
                {place.name}
              </p>
              {(place.clientName || place.empreendimento) && (
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  {place.clientName && (
                    <span className="text-xs text-accent/80 font-medium truncate">
                      {place.clientName}
                    </span>
                  )}
                  {place.clientName && place.empreendimento && (
                    <span className="text-surface-300/30 text-xs">·</span>
                  )}
                  {place.empreendimento && (
                    <span className="text-xs text-surface-300/60 truncate">
                      {place.empreendimento}
                    </span>
                  )}
                </div>
              )}
              {place.address && (
                <p className="text-xs text-surface-300/50 truncate mt-0.5">
                  {place.address}
                </p>
              )}
              <p className="text-[10px] font-mono text-surface-300/30 mt-1">
                {place.coordinates.lat.toFixed(5)}, {place.coordinates.lng.toFixed(5)}
              </p>
            </div>

            {/* Remove button */}
            {!ordered && (
              <button
                onClick={() => onRemove(place.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-danger flex-shrink-0"
                title="Remover"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Description field */}
          {onDescriptionChange ? (
            <div className="mt-2.5 ml-10">
              <input
                type="text"
                value={place.description ?? ""}
                onChange={(e) => onDescriptionChange(place.id, e.target.value)}
                placeholder="Adicionar anotação…"
                maxLength={300}
                className="w-full text-xs bg-transparent text-surface-200 placeholder:text-surface-300/25 border-b border-surface-800/50 focus:border-accent/50 outline-none pb-1 transition-colors"
              />
            </div>
          ) : place.description ? (
            <p className="mt-2 ml-10 text-xs text-surface-300/60 italic">
              {place.description}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
