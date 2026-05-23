# Raspberry Pi — Party Games (tryb offline)

Malinka działa jako **serwer imprezowy**: rozdaje Wi‑Fi, serwuje stronę z grami i trzyma **lokalną bazę pokoi** — bez internetu.

Główny przegląd projektu (chmura vs Malinka): [`../../README.md`](../../README.md).  
Reguły RTDB i PartBox dla AI: [`../../.cursorrules`](../../.cursorrules).

**Wersja aplikacji (UI):** sprawdź na dole strony lub `party-games/version.json` (np. **0.6.6**).

---

## Założenia (infrastruktura + impreza)

1. **Jeden host sprzętowy** — Raspberry Pi 3B+ (PartBox), zasilanie z gniazdka przed imprezą; po boot ~2 min do pełnej gotowości.
2. **Gracze na jednej sieci logicznej** — na imprezie w terenie: hotspot **PartBox-Gry** + **`http://10.42.0.1`** u wszystkich (nie mieszaj z LAN hosta).
3. **Brak internetu** — pokoje w emulatorze Firebase RTDB (port 9000, projekt `party-games-14ae8`), nie Google Cloud.
4. **Telefony = UI**, **Malinka = pliki + Java RTDB** — CPU telefonu nie jest problemem; wąskim gardłem jest emulator i Wi‑Fi AP na Pi 3B.
5. **Ten sam hostname** — inny adres w pasku URL = inny „świat” bazy (np. host na `192.168.1.52`, goście na `10.42.0.1`).
6. **Treść gier w bundlu** (`gameContent.json`) — RTDB: gracze, `gameState`, `isLocked` tylko.
7. **Autostart po prądzie** wymaga jednorazowego `sudo bash ~/pi/setup-boot-sudo.sh` (DNS + systemd + PM2 startup + linger).
8. **Wszystkie Androidy na PartBox** — optymalizacje w aplikacji (`low-power`, kolejka RTDB) dotyczą **każdego** telefonu na emulatorze, nie tylko Xiaomi; MIUI było bardziej widoczne przez oszczędzanie baterii i duże re-rendery przy pulach kart.

---

## Architektura na Malinie

```
┌─────────────────────────────────────────────────────────┐
│  Raspberry Pi (PartBox)                                   │
│                                                           │
│  Wi‑Fi AP: PartBox-Gry  →  10.42.0.1/24  (wlan0)        │
│  [opcjonalnie] Ethernet  →  192.168.1.x  (eth0, LAN)      │
│                                                           │
│  ┌─────────────┐    ┌──────────────────────────────┐   │
│  │ PM2         │    │ PM2                           │   │
│  │ party-web   │    │ firebase-db                   │   │
│  │ serve :80   │    │ firebase emulators (Java) :9000│   │
│  │ ~/dist/     │    │ project: party-games-14ae8    │   │
│  └─────────────┘    └──────────────────────────────┘   │
│                                                           │
│  DNS (dnsmasq via NetworkManager):                       │
│    partygames.pb, party.pb, gry.pb → 10.42.0.1           │
└─────────────────────────────────────────────────────────┘
         ▲                    ▲
         │ HTTP :80           │ WebSocket / REST :9000
         │                    │
    ┌────┴────┐         ┌────┴────┐
    │ Telefon │         │ Telefon │
    │  gracz  │         │  host   │
    └─────────┘         └─────────┘
```

| Port | Usługa | Proces |
|------|--------|--------|
| **80** | Statyczna aplikacja (`dist/`) | `serve` (PM2 `party-web`) |
| **9000** | Firebase RTDB Emulator | Java (PM2 `firebase-db`) |
| **wlan0** | Hotspot `PartBox-Gry` | NetworkManager, `ipv4.method=shared` |

Pliki konfiguracyjne w repozytorium:

| Plik | Rola |
|------|------|
| `install-once.sh` | Skrót instalacji (wskazuje kroki A + B) |
| `setup-boot-sudo.sh` | **Jednorazowo sudo** — DNS + systemd + PM2 startup |
| `party-boot.sh` | Po każdym boot: czeka na sieć, start PM2, sprawdza :80 i :9000 |
| `party-box.service` | Systemd — wywołuje `party-boot.sh` |
| `ecosystem.config.cjs` | Definicja PM2 (`party-web`, `firebase-db`) |
| `fix-web.sh` | Naprawa strony na porcie 80 |
| `remote-install.sh` | PM2 bez sudo (SSH) |
| `setup-custom-dns.sh` | Tylko DNS (zawarte w `setup-boot-sudo.sh`) |
| `diagnose.sh` | Diagnostyka |
| `~/firebase.json` | Emulator `0.0.0.0:9000` |

---

## Adresy dla graczy

| Scenariusz | URL | Uwagi |
|------------|-----|--------|
| **Impreza offline (hotspot)** | `http://10.42.0.1` | **Zalecany** — zawsze po `PartBox-Gry` |
| **Impreza offline (domena)** | `http://partygames.pb` | Po `setup-boot-sudo.sh` |
| **Dom / LAN (PRISM)** | `http://192.168.1.52` | IP Malinki w routerze — zmienne; host **przekierowany** na `10.42.0.1` (build ≥ 0.6.4) |
| **Test z PC w LAN bez redirect** | `http://192.168.1.52?lan=1` | Tylko dev / `test:pi` |

**Diagnostyka w aplikacji:** na dole — `● Lokalna baza (host:9000)` = OK; `○ Chmura Google` = zły hostname lub stary `dist/`.

**QR / link zaproszenia:** zawsze `http://10.42.0.1` na trybie lokalnym (`getPartyOrigin` w `firebase.js`).

---

## Pierwsza konfiguracja Malinki

### Wymagania

- Raspberry Pi 3B+ (zalecane zasilacz 2.5 A+)
- Node.js (nvm), `firebase-tools`, `serve`, `pm2` — użytkownik `stas`
- Katalog `/home/stas/dist/` — zbudowana aplikacja (`npm run build` na PC)

### 1. Skopiuj pliki na Malinę

Z komputera w sieci LAN:

```powershell
cd party-games
npm run build
scp -r dist\* stas@192.168.1.52:/home/stas/dist/
scp -r pi stas@192.168.1.52:/home/stas/
```

*(IP dostosuj — `hostname -I` na Malinie.)*

### 2. Instalacja (dwa kroki)

**Krok A** — jako użytkownik `stas` (PM2, strona, baza):

```bash
bash ~/pi/remote-install.sh
```

**Krok B** — **jednorazowo z hasłem sudo** (autostart po resecie prądu + DNS):

```bash
sudo bash ~/pi/setup-boot-sudo.sh
```

To instaluje:

- `party-box.service` — po boot: `party-boot.sh` (sieć, porty 80/9000, PM2)
- PM2 `startup` + `linger` — procesy bez logowania na pulpit
- DNS dla `partygames.pb` itd.

Po **odłączeniu prądu** poczekaj **~2 min**, potem test: `http://10.42.0.1`.

Log bootu: `~/pi/party-boot.log` · status: `sudo systemctl status party-box`

Bez kroku B działa tylko ręczny start po SSH — **nie** jest niezawodne po resecie.

### 3. Hotspot Wi‑Fi

Połączenie NetworkManager: **PartBox-Gry** (AP, `autoconnect`). Hasło WPA — w systemie Malinki; podaj gościom razem z adresem strony.

---

## Aktualizacja gry (nowa wersja z PC)

```bash
cd party-games && npm run build
scp -r dist/* stas@<IP>:/home/stas/dist/
```

PM2 `party-web` serwuje pliki na bieżąco — restart zwykle **nie** jest potrzebny.  
Jeśli widać starą wersję: **twarde odświeżenie** na każdym telefonie (Ctrl+F5 / wyczyść cache dla `10.42.0.1`).

Bump: `party-games/version.json` (widoczne na dole strony).

---

## Jak aplikacja wybiera bazę

1. **`main.jsx`** — `maybeRedirectToApGateway()` (LAN → `10.42.0.1`, bez importu `firebase.js`).
2. **`firebase.js`** — `isLocalPartyHost(hostname)` → emulator lub chmura.
3. **`getEmulatorHost()`** — WebSocket na hostname strony; po redirect: `10.42.0.1:9000`; test: `?lan=1` zostaje na LAN IP.

**Lokalny emulator** dla m.in.:

- `localhost`
- `192.168.*`, `10.*`, `172.16–31.*`
- `partygames.pb`, `party.pb`, `gry.pb`, `partbox.pb`, `*.pb`, `*.local`

**Chmura Google** — każda inna domena (np. Vercel).

---

## Obciążenie Malinki i wydajność

### Co zużywa zasoby (Pi 3B+, ~1 GB RAM)

| Komponent | RAM (orient.) | CPU | Uwaga |
|-----------|---------------|-----|--------|
| Firebase Emulator (Java) | 120–180 MB | **najwyższe** | Lawina `update` przy szybkiej grze (np. Prawda/Wyzwanie) |
| `serve` (strona) | 30–60 MB | niskie | Tylko statyczne pliki |
| Hotspot Wi‑Fi | — | średnie | Wiele telefonów na Pi 3B = wąskie gardło RF |
| Pulpit (GUI) | 100–300 MB | zbędne | Wyłącz na serwerku imprezowym |

Gry **nie renderują się** na Malinie — liczy się **kolejność i rozmiar zapisów RTDB** + stabilność AP.

### Optymalizacje w aplikacji (od v0.6.6 — PartBox)

| Mechanizm | Plik | Efekt |
|-----------|------|--------|
| Kolejka `set`/`update`/`get` | `lib/rtdb.js`, `rtdbThrottle.js` | Jedna operacja RTDB na raz; min. ~220 ms między zapisami |
| Debounce snapshotów | `lowPower.js`, `useRoomGameState`, `App.jsx` | `gameState` 400 ms, `players` 300 ms |
| Sync UI po akcji | `getMinUiSyncMs()` (~420 ms) | Krótka kulka „Synchronizacja z Maliną” zamiast freeze emulatora |
| Fingerprint TOD | `TruthOrDare.jsx` | Gracz w kolejce nie dostaje re-renderów przy zmianie tylko pul |
| Blokada double-tap | `TruthOrDare.jsx` | Drugi szybki klik nie zalewa kolejki |
| Ping RTDB off w grze | `useConnectionPing.js` | Mniej odczytów, gdy i tak lecą zapisy |
| `html.low-power` | `lowPower.js`, `app.css` | Mniej animacji / blur na telefonach |
| Join / presence grace | `App.jsx`, `lowPower.js` | 12 s po join; 3,5 s przed „utrata pokoju” |
| Redirect + QR | `partyRedirect.js`, `getPartyOrigin` | Jeden świat bazy na imprezie |

**Telefony:** problem „zacięcia przy szybkiej grze” dotyczy **wszystkich marek** podłączonych do tego samego emulatora — aplikacja celowo **spowalnia zapis** (~0,4 s), żeby Java na Pi nadążyła.

### Quick fixy (bez zmiany kodu)

1. **Włącz Malinę 2–3 min przed gośćmi** — rozgrzanie JVM.
2. **Autostart PM2** (`setup-boot-sudo.sh`) — po prądzie usługi same wstają.
3. **Impreza = tylko hotspot** — wszyscy `10.42.0.1`; odłącz Ethernet, jeśli nie potrzebny.
4. **Wyłącz pulpit** (więcej RAM):
   ```bash
   sudo systemctl set-default multi-user.target
   sudo reboot
   ```
5. **Rozgrzanie emulatora po boot** (opcjonalnie, cron):
   ```bash
   @reboot sleep 90 && curl -s -o /dev/null http://127.0.0.1:9000/.json
   ```

### Plany optymalizacji (przyszłość)

| Priorytet | Działanie | Efekt |
|-----------|---------|--------|
| Krótki | Nginx zamiast `serve` | Mniej Node |
| Krótki | `multi-user.target` (bez GUI) | Więcej RAM |
| Średni | TOD: indeksy pul w RTDB zamiast pełnych tablic | Największy zysk bez zmiany backendu |
| Duży | Lżejszy backend zamiast Firebase Emulator | Wymaga zmian w aplikacji |
| Sprzęt | Raspberry Pi 4/5 | Szybszy Java, lepszy AP |

Przy **4–8 graczach** i buildzie **≥ 0.6.6** wolne chwile to limit Pi 3B + Java, nie „zepsuty” pokój.

---

## Typowy przebieg imprezy

1. Włącz Malinę → ~2 min (Wi‑Fi + PM2).
2. Telefony: Wi‑Fi **PartBox-Gry**.
3. Przeglądarka: **`http://10.42.0.1`** (lub `partygames.pb` po DNS).
4. Na dole: **Lokalna baza**.
5. Host zakłada pokój → QR — goście z **tego samego** adresu.
6. Przy szybkiej grze: krótka synchronizacja (kulka) — normalne na Pi 3B.

---

## Rozwiązywanie problemów

| Objaw | Przyczyna | Co zrobić |
|-------|-----------|-----------|
| **Tylko Ty masz stronę**, goście nie | Port 80 / PM2 po reboot | `bash ~/pi/fix-web.sh`; wszyscy na **PartBox-Gry** + **`http://10.42.0.1`** |
| **Domeny `.pb` u nikogo** | Brak DNS | `sudo bash ~/pi/setup-boot-sudo.sh` |
| Na dole: **Chmura Google** | Zły hostname / stary `dist/` | `10.42.0.1`; Ctrl+F5 na telefonach |
| Strona OK, pokój nie | Emulator down | `pm2 list` → `firebase-db`; port 9000 |
| Goście się nie widzą | Host LAN + goście AP | Wszyscy **PartBox-Gry** + **`http://10.42.0.1`**; build ≥ 0.6.4 |
| **Freeze / lag przy szybkiej grze** | Lawina RTDB do Javy | Build **≥ 0.6.6** (kolejka); nie klikaj wielokrotnie podczas kulki sync |
| **Miganie nicku (Xiaomi)** | Re-rendery + MIUI | Build ≥ 0.6.5 (fingerprint TOD); twarde odświeżenie cache |
| Wyrzuca z pokoju bez powodu | Wolny snapshot / emulator | Build ≥ 0.6.5 (join grace); sprawdź ping bazy |
| iPhone nie otwiera strony | Prywatny DNS / Relay | `IosWifiHelp` w aplikacji; DNS automatyczny na Wi‑Fi |
| Po reboot brak strony | Brak `pm2 startup` | `sudo bash ~/pi/setup-boot-sudo.sh` |

### Impreza „tu i teraz” (bez sudo)

1. Wszyscy: Wi‑Fi **PartBox-Gry**.
2. Wszyscy: **`http://10.42.0.1`**.
3. SSH: `bash ~/pi/fix-web.sh` jeśli brak strony.
4. ~2 min po włączeniu prądu przed testem.

### Przydatne komendy (SSH)

```bash
hostname -I                    # IP w LAN i na AP (10.42.0.1)
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pm2 list
pm2 logs firebase-db --lines 30
pm2 restart party-web
nmcli con show PartBox-Gry     # status hotspotu
```

---

## Założenia sieciowe (PRISM / LAN vs hotspot)

- **PRISM / dom:** Malinka i telefony w `192.168.1.x` — można testować z `?lan=1`; na imprezie host i tak powinien skończyć na `10.42.0.1` (redirect).
- **W terenie:** tylko hotspot — **`10.42.0.1`** lub `.pb`. **Główny scenariusz projektu.**

**Nie mieszaj** w jednej imprezie: część graczy na `192.168.1.52`, część na `10.42.0.1` — to dwa światy emulatora (gdy oba interfejsy aktywne).

---

## Testy E2E przeciw Malinie

Z PC w sieci (repo root):

```bash
set PARTY_PI_URL=http://192.168.1.52
npm run test:pi
```

Hotspot: `PARTY_PI_URL=http://10.42.0.1`. Pominięcie: `SKIP_PI_TESTS=1`.

---

## Bezpieczeństwo (świadome ograniczenia)

- Hotspot — sieć imprezowa; nie łącz z wrażliwą siecią domową bez potrzeby.
- Emulator Firebase **nie jest** produkcyjną bazą Google — lokalny stub na imprezę.
- `firebase.js` zawiera klucze projektu — repozytorium traktuj jak prywatne; na Malinie używany jest emulator.

---

## Powiązane pliki w repozytorium

- [`../../README.md`](../../README.md) — przegląd, założenia projektu, dev
- [`../src/lib/firebase.js`](../src/lib/firebase.js) — środowisko, origin, emulator host
- [`../src/lib/rtdbThrottle.js`](../src/lib/rtdbThrottle.js) — kolejka PartBox
- [`../src/lib/lowPower.js`](../src/lib/lowPower.js) — debounce i grace
- [`../../.cursorrules`](../../.cursorrules) — schema RTDB, reguły dla agentów
