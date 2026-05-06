"use client";

import { LinkEntry } from "@/types";

interface LinkInputProps {
  value: string;
  onChange: (value: string) => void;
  detectedEntries: LinkEntry[];
}

export default function LinkInput({ value, onChange, detectedEntries }: LinkInputProps) {
  return (
    <div className="space-y-3">
      {/* Textarea */}
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-accent/20 to-accent-dark/10 rounded-2xl blur opacity-0 group-focus-within:opacity-100 transition-opacity duration-300" />
        <div className="relative bg-surface-900/80 border border-surface-800/80 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <label className="text-xs font-medium text-surface-300 uppercase tracking-widest">
              Cole aqui a conversa do WhatsApp
            </label>
            {detectedEntries.length > 0 && (
              <span className="text-xs font-mono text-accent bg-accent/10 px-2 py-0.5 rounded-full">
                {detectedEntries.length} {detectedEntries.length === 1 ? "local" : "locais"} detectados
              </span>
            )}
          </div>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
              "Cole aqui a conversa completa. O sistema detecta automaticamente os links e nomes.\n\nExemplo:\nhttps://maps.app.goo.gl/abc123\nTiago Bublitz - correção de solo\n\nhttps://maps.app.goo.gl/def456\nIrene Ganse - construção de galpão"
            }
            rows={10}
            className="w-full bg-transparent px-4 py-2 text-sm font-mono text-surface-100 placeholder:text-surface-300/30 resize-none focus:outline-none leading-relaxed"
            spellCheck={false}
          />
          <div className="px-4 pb-3 flex items-center gap-2 text-surface-300/50 text-xs">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            Links e nomes são detectados automaticamente do texto colado
          </div>
        </div>
      </div>

      {/* Detected entries preview */}
      {detectedEntries.length > 0 && (
        <div className="space-y-2 animate-fade-in">
          <p className="text-xs font-medium text-surface-300/50 uppercase tracking-widest px-1">
            Detectados
          </p>
          <div className="space-y-1.5">
            {detectedEntries.map((entry, index) => (
              <div
                key={entry.id}
                className="flex items-start gap-2.5 bg-surface-900/50 border border-surface-800/50 rounded-lg px-3 py-2 animate-fade-in"
                style={{ animationDelay: `${index * 30}ms` }}
              >
                <span className="w-5 h-5 rounded-md bg-surface-800 text-surface-300/60 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {entry.clientName ? (
                      <span className="text-xs font-medium text-surface-100">{entry.clientName}</span>
                    ) : (
                      <span className="text-xs text-surface-300/30 italic">sem nome</span>
                    )}
                    {entry.empreendimento && (
                      <>
                        <span className="text-surface-300/30 text-xs">·</span>
                        <span className="text-xs text-surface-300/60">{entry.empreendimento}</span>
                      </>
                    )}
                  </div>
                  <p className="text-[10px] font-mono text-surface-300/30 truncate mt-0.5">
                    {entry.link}
                  </p>
                </div>
                <div className="w-1.5 h-1.5 rounded-full bg-accent/60 flex-shrink-0 mt-1.5" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
