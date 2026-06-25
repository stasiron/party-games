# Jungle Speed — karty (dane + grafika SVG)

## 1) Lista kart (logika gry)

Plik: **`cards.v1.json`** (w tym folderze)

```json
{ "id": "circle-red", "shape": "circle", "color": "red" }
```

- `id` — unikalne; używane też jako nazwa pliku pełnej karty (opcjonalnie)
- `shape` — **tylko to pole decyduje o pojedynku**
- `color` — wyłącznie wygląd (nie wpływa na wynik)

## 2) Grafika wektorowa (SVG)

### Wariant A — zalecany na start: 8 kształtów + kolor z JSON

Wrzucaj / podmieniaj pliki w:

```txt
party-games/src/assets/jungle-speed/shapes/
  circle.svg
  triangle.svg
  square.svg
  star.svg
  diamond.svg
  wave.svg
  cross.svg
  spiral.svg
```

**Konwencja pliku kształtu:**

- `viewBox="0 0 100 100"` (lub inny, ale spójny dla wszystkich)
- wypełnienie: `fill="currentColor"` (kolor ustawia aplikacja z pola `color` w JSON)
- jeden dominujący kształt, czytelny na telefonie z dystansu
- bez tekstu w SVG (dostępność: etykiety są w UI)

### Wariant B — pełna karta (własny projekt na każdą kombinację)

Wrzucaj pliki w:

```txt
party-games/src/assets/jungle-speed/cards/
  circle-red.svg
  star-blue.svg
  ...
```

Nazwa pliku = **`id` z `cards.v1.json`** (np. `circle-red.svg`).

Jeśli plik istnieje, gra pokazuje **ten** SVG zamiast składania `shape + color`.

Przydatne gdy karta ma tło, obramowanie, cienie lub kilka kolorów naraz.

## 3) Narzędzia

- **Inkscape / Figma / Illustrator** — eksport SVG
- Nie trzeba „turtle” w runtime — SVG ładuje się w przeglądarce (lekkie, skalowalne)

## 4) Po dodaniu plików

1. Zapisz SVG w odpowiednim folderze (`shapes/` lub `cards/`).
2. Upewnij się, że wpis jest w `cards.v1.json`.
3. Odśwież dev server (`npm run dev`) — Vite podłącza nowe pliki przy starcie.

## 5) v1 — bez kart specjalnych

Nie dodawaj osobnych typów / flag specjalnych w JSON ani osobnego folderu `special/` na tym etapie.
