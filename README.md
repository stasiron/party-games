# Party Games

Imprezowa aplikacja webowa (React + Firebase RTDB) z dynamicznymi pokojami, kontami graczy i trybem offline na Raspberry Pi (PartBox).

## Szybki start (dev)

```bash
npm install
npm run dev
```

Aplikacja domyślnie: `http://localhost:5173`

## Build i lint

```bash
npm run build
npm run lint
```

Build pod Malinę (PartBox):

```bash
npm run build:pi
```

PWA (manifest + service worker) jest domyślnie **włączone** w `npm run build`, **wyłączone** w `build:pi` (`VITE_ENABLE_PWA=false`). Szczegóły: [`docs/PWA.md`](../docs/PWA.md).

## Zmienne środowiskowe (Vite)

| Zmienna | Domyślnie | Opis |
|---------|-----------|------|
| `VITE_ENABLE_PWA` | `true` (brak = wł.) | Manifest + service worker |
| `VITE_FIREBASE_*` | wartości w `client.ts` | Konfiguracja Firebase |

Plik `.env.pi` ustawia `VITE_ENABLE_PWA=false` dla buildu PartBox.

## Load test RTDB

Z root monorepo (wymaga JDK 21+ do emulatora):

```bash
npm run load-test:smoke
```

Zobacz [`docs/CAPACITY.md`](../docs/CAPACITY.md) i [`tools/load-test/README.md`](../tools/load-test/README.md).

## Firebase (reguły)

```bash
firebase deploy --only database
firebase deploy --only firestore:rules
```

## Wersja

Źródło prawdy: `version.json` (obecnie widoczna w UI po zbudowaniu).

## Dokumentacja

- Pełny opis produktu i architektury: repozytorium nadrzędne `Paty-Games` (monorepo z testami Playwright)
- Deploy Raspberry Pi: [`pi/README.md`](pi/README.md)
- RTDB rules: [`database.rules.json`](database.rules.json)
