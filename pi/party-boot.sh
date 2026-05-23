#!/usr/bin/env bash
# Uruchamiane po każdym boot (systemd party-box.service).
# Czeka na sieć, odtwarza PM2, weryfikuje porty 80 i 9000.
set -euo pipefail

export HOME="${HOME:-/home/stas}"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.npm-global/bin:$PATH"

PI_DIR="$HOME/pi"
ECO="$PI_DIR/ecosystem.config.cjs"
LOG="$HOME/pi/party-boot.log"
MAX_WAIT=150

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

port_open() {
  local port="$1"
  ss -tln 2>/dev/null | grep -q ":${port} " || return 1
}

start_pm2_apps() {
  if [[ -f "$ECO" ]]; then
    pm2 start "$ECO" 2>/dev/null || true
  fi
  pm2 resurrect 2>/dev/null || true

  if ! pm2 describe firebase-db >/dev/null 2>&1; then
    log "Start firebase-db"
    pm2 start "$ECO" --only firebase-db
  fi

  if ! pm2 describe party-web >/dev/null 2>&1 || ! port_open 80; then
    log "Naprawa party-web (port 80)"
    bash "$PI_DIR/fix-web.sh" >>"$LOG" 2>&1 || true
  fi
}

log "=== party-boot start ==="

# Czekaj na NetworkManager / hotspot (10.42.0.1) lub LAN
for ((i = 1; i <= MAX_WAIT; i++)); do
  if hostname -I 2>/dev/null | grep -qE '10\.42\.0\.1|192\.168\.'; then
    log "Sieć gotowa (iteracja $i)"
    break
  fi
  sleep 2
done

start_pm2_apps

for ((i = 1; i <= 60; i++)); do
  if port_open 80 && port_open 9000; then
    log "OK: porty 80 i 9000 nasłuchują"
    pm2 save >>"$LOG" 2>&1 || true
    exit 0
  fi
  log "Czekam na porty 80/9000 ($i/60) — web:$(port_open 80 && echo tak || echo nie) db:$(port_open 9000 && echo tak || echo nie)"
  start_pm2_apps
  sleep 3
done

log "BŁĄD: po ${MAX_WAIT}s brak portu 80 lub 9000"
pm2 list >>"$LOG" 2>&1 || true
exit 1
