# Raspberry Pi — Party Games (offline / PartBox)

Raspberry Pi działa jako serwer imprezowy offline: hotspot Wi-Fi + serwowanie aplikacji + lokalna synchronizacja RTDB.
Auth/Firestore odpowiada tylko za konto i reconnect poza krytycznym flow rozgrywki realtime.

Powiązane:
- główny opis projektu: [`../../README.md`](../../README.md)
- reguły implementacyjne: [`../../.cursorrules`](../../.cursorrules)

---

## Docelowy stan

- gracze łączą się przez `PartBox-Gry`
- aplikacja działa pod `http://10.42.0.1` (lub alias `.pb`)
- proces web + sync startują automatycznie po restarcie zasilania

---

## Architektura

- `party-web` (PM2): statyczna aplikacja `dist/` na porcie `80`
- lokalny sync RTDB na porcie `9000`
- hotspot `PartBox-Gry` jako podstawowy punkt dostępu
- opcjonalnie Firebase Auth/Firestore (konto/reconnect) przy dostępie do internetu

Kluczowa zasada: na jednej imprezie wszyscy gracze muszą używać tego samego hosta (`10.42.0.1`).

---

## Pierwsza konfiguracja

1. Skopiuj na Malinę foldery `dist/` i `pi/`.
2. Uruchom:

```bash
bash ~/pi/remote-install.sh
sudo bash ~/pi/setup-boot-sudo.sh
```

Po tym usługi startują automatycznie po boot.

---

## Aktualizacja z PC

Z katalogu `party-games`:

```powershell
.\pi\deploy-from-pc.ps1
```

Skrypt buduje, kopiuje pliki i restartuje usługi.

---

## Szybka diagnostyka

```bash
pm2 list
pm2 logs party-web --lines 50
pm2 logs firebase-db --lines 50
ss -tlnp | grep -E ':80|:9000'
```

Najczęstsze źródło problemów:
- różne hosty u graczy (`192.168.x.x` vs `10.42.0.1`)
- brak autostartu po restarcie (nieuruchomiony krok `setup-boot-sudo.sh`)

---

## Troubleshooting

- Goście nie widzą pokoi:
  - sprawdź, czy wszyscy są na `PartBox-Gry`
  - sprawdź, czy wszyscy używają `http://10.42.0.1`
- Brak strony:
  - `bash ~/pi/fix-web.sh`
  - `pm2 restart party-web`
- Brak synchronizacji:
  - `pm2 logs firebase-db`
  - sprawdź, czy port `9000` nasłuchuje

---

## Notatki wydajnościowe

- Ograniczaj liczbę równoczesnych ciężkich akcji (szczególnie w dużych pokojach).
- Priorytet na Pi: stabilność synchronizacji i Wi-Fi, nie „efekty wizualne”.
- Aplikacja ma tryb low-power i ogranicza obciążenie RTDB w trybie emulatora.
- Lista pokoi dla gościa używa `roomsPublic`, więc odczyty są lżejsze niż pełne skany `rooms`.
- Cleanup starych pokoi działa przez pojedynczy lease executor (`/_maintenance/roomsCleanupLease`), co ogranicza równoległe skany.
- Po refaktorze więcej logiki rund i losowań działa lokalnie po stronie klienta (`games/*/engine.js`), a RTDB dostaje głównie wynikowe update'y stanu.
- Funkcje konta (Google/email-link, nick, historia sesji) powinny degradować się łagodnie: brak internetu nie może blokować grania lokalnego.
- Panel operatorski `/cms` ma być osobną stroną i nie może dokładać stałych ciężkich subskrypcji do flow gry; preferowane są lekkie odczyty on-demand.
- `appConfig` w RTDB może sterować dostępnością gier runtime, ale nie zastępuje `comingSoon` z katalogu build-time.
- `appMetrics` zbiera dzienne liczniki zdarzeń (UTC); na Pi też działa, ale nie jest krytyczne dla synchronizacji pokoju.
