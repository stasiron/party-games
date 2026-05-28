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
