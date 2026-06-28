"use client";

import { useEffect, useState } from "react";

interface SplashScreenProps {
  onDone: () => void;
}

export default function SplashScreen({ onDone }: SplashScreenProps) {
  const [phase, setPhase] = useState<"visible" | "fading">("visible");

  useEffect(() => {
    const fadeTimer = setTimeout(() => setPhase("fading"), 2200);
    const doneTimer = setTimeout(() => onDone(), 2800);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, [onDone]);

  return (
    <div
      className="fixed inset-0 z-[9998] flex flex-col items-center justify-center transition-opacity duration-600"
      style={{
        background: "linear-gradient(160deg, #003641 0%, #002530 60%, #001e28 100%)",
        opacity: phase === "fading" ? 0 : 1,
        transition: "opacity 0.6s ease-out",
      }}
    >
      {/* Decoração de fundo */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 30%, #00AE9D0D 0%, transparent 70%), " +
            "radial-gradient(ellipse 50% 40% at 80% 70%, #49479D08 0%, transparent 60%)",
        }}
      />

      {/* Conteúdo central */}
      <div className="relative flex flex-col items-center gap-5 px-8 text-center">
        {/* Ícone */}
        <div
          className="w-20 h-20 rounded-[22px] flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, #00AE9D 0%, #008070 100%)",
            boxShadow: "0 8px 32px #00AE9D30, 0 2px 8px #00000040",
          }}
        >
          <svg
            width="38"
            height="38"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
            <circle cx="12" cy="9" r="2.5" />
          </svg>
        </div>

        {/* Nome */}
        <p
          className="text-xs font-bold tracking-[0.25em] uppercase"
          style={{ color: "#00AE9D99" }}
        >
          RotaFácil
        </p>

        {/* Frase principal */}
        <h1
          className="font-display text-3xl sm:text-4xl tracking-tight leading-tight"
          style={{ color: "#e8f6f5" }}
        >
          Sua rota ainda mais{" "}
          <span style={{ color: "#00AE9D" }}>fácil</span>
        </h1>

        {/* Subtítulo */}
        <p className="text-sm font-medium leading-relaxed" style={{ color: "#a0c4c8" }}>
          Aplicativo destinado a{" "}
          <span style={{ color: "#C9D200", fontWeight: 600 }}>Fiscais</span>
          {" "}e{" "}
          <span style={{ color: "#C9D200", fontWeight: 600 }}>Peritos</span>
        </p>

        {/* Pontos decorativos */}
        <div className="flex gap-2 mt-1">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#00AE9D" }} />
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#C9D200" }} />
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#49479D" }} />
        </div>
      </div>

      {/* Linha inferior */}
      <div
        className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5"
      >
        <div
          className="w-px h-8"
          style={{
            background: "linear-gradient(to bottom, #00AE9D40, transparent)",
          }}
        />
        <p className="text-[10px] tracking-widest uppercase" style={{ color: "#00AE9D40" }}>
          Carregando…
        </p>
      </div>
    </div>
  );
}
