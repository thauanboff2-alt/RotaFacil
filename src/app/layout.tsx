import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RotaFácil — Otimizador de Rotas",
  description:
    "Cole links do Google Maps, otimize a ordem das paradas e abra a rota pronta no Google Maps.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
