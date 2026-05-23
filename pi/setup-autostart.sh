#!/usr/bin/env bash
# Uruchom na Malinie jako użytkownik stas: bash ~/party-games/pi/setup-autostart.sh
set -euo pipefail

export PATH="$HOME/.npm-global/bin:$HOME/.nvm/versions/node/v24.16.0/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

PI_DIR="${PARTY_PI_DIR:-$HOME/pi}"
ECO="$PI_DIR/ecosystem.config.cjs"

if [[ ! -f "$ECO" ]]; then
  echo "Brak $ECO — skopiuj folder party-games/pi na Malinę (np. ~/pi)."
  exit 1
fi

echo "==> PM2: strona + emulator Firebase ($ECO)"
pm2 delete party-web 2>/dev/null || true
pm2 start "$ECO" --only party-web

if ! pm2 describe firebase-db >/dev/null 2>&1; then
  pm2 start "$ECO" --only firebase-db
fi

pm2 save

echo ""
echo "==> Jednorazowo jako root (sudo) — autostart po włączeniu prądu:"
echo "  sudo loginctl enable-linger stas"
echo "  sudo env PATH=\$PATH:/home/stas/.nvm/versions/node/v24.16.0/bin:/home/stas/.npm-global/bin pm2 startup systemd -u stas --hp /home/stas"
echo "  pm2 save"
echo ""
echo "Hotspot PartBox-Gry: autoconnect jest w NetworkManager."
echo "Po reboot: Wi‑Fi AP + pm2 (web:80, baza:9000)."
