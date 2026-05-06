# RotaFácil — Otimizador de Rotas via Google Maps

Sistema web para otimização de rotas a partir de links compartilhados do Google Maps. Cole links, otimize a ordem das paradas por tempo de deslocamento e abra a rota pronta no Google Maps com um clique.

## Funcionalidades

- **Input flexível**: Cole links do Google Maps (curtos e longos), um por linha
- **Resolução automática**: Expande links curtos `maps.app.goo.gl`, extrai coordenadas, place_id e nomes
- **Localização do usuário**: Captura a posição atual como origem da rota
- **Otimização por tempo**: Usa a Google Directions API com `optimizeWaypoints=true`
- **Fallback inteligente**: Se a API falhar, usa heurística de vizinho mais próximo (Haversine)
- **Deduplicação**: Remove locais duplicados ou muito próximos (< 50m)
- **URL final do Google Maps**: Gera link pronto com origin, destination, waypoints e travelmode
- **Ação direta**: Botão "Abrir rota no Google Maps" redireciona imediatamente
- **Cópia fácil**: Botão para copiar o link da rota

## Stack

- **Next.js 14** (App Router)
- **React 18**
- **TypeScript**
- **Tailwind CSS**
- **Zod** (validação)
- **Google Maps APIs** (Directions, Geocoding, Places)

## Arquitetura

```
src/
├── app/
│   ├── api/
│   │   ├── resolve-links/   → POST: expande e resolve links do Google Maps
│   │   └── optimize-route/  → POST: otimiza ordem via Directions API
│   ├── layout.tsx           → Root layout
│   ├── page.tsx             → Página principal (client component)
│   └── globals.css          → Estilos globais + Tailwind
├── components/
│   ├── LinkInput.tsx        → Textarea para colar links
│   ├── LocationButton.tsx   → Botão de geolocalização
│   ├── PlaceCards.tsx       → Cards dos locais resolvidos
│   ├── OptimizedRoute.tsx   → Resultado final com CTA
│   ├── FailedLinks.tsx      → Links que falharam
│   └── StepIndicator.tsx    → Indicador de progresso
├── lib/
│   ├── link-parser.ts       → Parser de links do Google Maps
│   ├── maps-url-builder.ts  → Construtor de URL final + heurísticas
│   └── validation.ts        → Schemas Zod
└── types/
    └── index.ts             → Tipos TypeScript
```

## Setup

### 1. Instale as dependências

```bash
npm install
```

### 2. Configure as variáveis de ambiente

```bash
cp .env.example .env.local
```

Edite `.env.local` e adicione sua API key do Google Maps:

```
GOOGLE_MAPS_API_KEY=sua_chave_aqui
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=sua_chave_aqui
```

### 3. APIs necessárias no Google Cloud Console

Ative as seguintes APIs no seu projeto:

- **Directions API** — otimização de rotas
- **Geocoding API** — geocodificação reversa
- **Places API** — busca por texto e detalhes de lugares

### 4. Execute

```bash
npm run dev
```

Acesse `http://localhost:3000`

## Fluxo de uso

1. Ative a localização (botão no topo)
2. Cole links do Google Maps na textarea (um por linha)
3. Clique "Validar locais" — o sistema resolve cada link
4. Revise os locais reconhecidos (pode remover indesejados)
5. Clique "Otimizar rota" — o sistema calcula a melhor ordem
6. Veja o resumo (tempo, distância, sequência)
7. Clique "Abrir rota no Google Maps" — abre direto no app/navegador

## Limitações e decisões técnicas

### URL do Google Maps
- Suporta até ~23 waypoints por URL (limite prático de ~2048 caracteres)
- O parâmetro `optimize:true` funciona apenas na Directions API, não na URL
- A otimização é feita server-side e a URL já reflete a ordem otimizada

### Links curtos
- Links `maps.app.goo.gl` são expandidos via redirect no server
- Alguns links podem falhar se expirados ou com proteção anti-bot
- O sistema tenta HEAD primeiro, depois GET como fallback

### Directions API
- Limite de 25 waypoints por request
- A API otimiza waypoints por tempo, considerando tráfego em tempo real
- Se a API falhar, o sistema usa nearest-neighbor como fallback

### Rota aberta
- A rota NÃO retorna à origem
- O destino final é o último ponto da sequência otimizada
- A origem é sempre a localização atual do usuário

## Melhorias futuras

1. **Drag & drop** para reordenar paradas manualmente
2. **Mapa visual** com preview da rota antes de abrir no Google Maps
3. **Salvar rotas** com localStorage ou banco de dados
4. **Compartilhar rota** via link curto
5. **Import em massa** via CSV ou planilha
6. **Múltiplos modos** de transporte (a pé, bicicleta, transporte público)
7. **Horários de visita** com janelas de tempo
8. **PWA** para uso offline e atalho na home screen
9. **Histórico** de rotas anteriores
10. **Estimativa de custo** de combustível

## Licença

MIT
