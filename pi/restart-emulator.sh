#!/usr/bin/env bash
# Po zmianie projektu emulatora (party-games-14ae8) — jedna wspólna baza.
set -euo pipefail
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.npm-global/bin:$PATH"

pm2 delete firebase-db 2>/dev/null || true
pm2 start "$HOME/pi/ecosystem.config.cjs" --only firebase-db
sleep 5
pm2 save
pm2 list
ss -tlnp | grep 9000 || true
echo "Emulator: project party-games-14ae8"
