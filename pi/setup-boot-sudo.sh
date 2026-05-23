#!/usr/bin/env bash
# JEDNORAZOWO na Malinie (wszystko po resecie prądu):
#   sudo bash ~/pi/setup-boot-sudo.sh
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Uruchom: sudo bash $0"
  exit 1
fi

PI_USER="${SUDO_USER:-stas}"
PI_HOME="/home/$PI_USER"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> 1/5 DNS (domeny .pb dla telefonów)"
install -d /etc/NetworkManager/dnsmasq-shared.d
install -m 644 "$SCRIPT_DIR/partygames-dns.conf" /etc/NetworkManager/dnsmasq-shared.d/partygames.conf
if ! grep -q 'partygames.pb' /etc/hosts 2>/dev/null; then
  echo "10.42.0.1 partygames.pb party.pb gry.pb partbox.pb" >> /etc/hosts
fi
nmcli connection modify PartBox-Gry connection.autoconnect-priority 100 2>/dev/null || true

echo "==> 2/5 Systemd party-box.service (strażnik po boot)"
install -m 644 "$SCRIPT_DIR/party-box.service" /etc/systemd/system/party-box.service
systemctl daemon-reload
systemctl enable party-box.service

echo "==> 3/5 PM2 autostart użytkownika $PI_USER"
loginctl enable-linger "$PI_USER"

sudo -u "$PI_USER" bash -lc '
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  export PATH="$HOME/.npm-global/bin:$PATH"
  cd "$HOME"
  pm2 delete party-web 2>/dev/null || true
  bash "$HOME/pi/fix-web.sh"
  pm2 describe firebase-db >/dev/null 2>&1 || pm2 start "$HOME/pi/ecosystem.config.cjs" --only firebase-db
  pm2 save
'

# pm2 startup — wygeneruj i wykonaj linię sudo
STARTUP_LINE=$(sudo -u "$PI_USER" bash -lc '
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  export PATH="$HOME/.npm-global/bin:$PATH"
  pm2 startup systemd -u '"$PI_USER"' --hp '"$PI_HOME"' 2>&1 | grep -E "^sudo env" | head -1
')
if [[ -n "$STARTUP_LINE" ]]; then
  echo "==> 4/5 $STARTUP_LINE"
  eval "$STARTUP_LINE"
  sudo -u "$PI_USER" bash -lc '
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    export PATH="$HOME/.npm-global/bin:$PATH"
    pm2 save
  '
else
  echo "UWAGA: uruchom ręcznie: sudo -u $PI_USER pm2 startup systemd"
fi

echo "==> 5/6 Sieć: dostęp do Malinki z obu interfejsów (opcjonalnie)"
sysctl -w net.ipv4.ip_forward=1 2>/dev/null || true
grep -q 'net.ipv4.ip_forward=1' /etc/sysctl.d/99-party-games.conf 2>/dev/null || \
  echo 'net.ipv4.ip_forward=1' > /etc/sysctl.d/99-party-games.conf

echo "==> 6/6 NetworkManager + pierwszy boot check"
systemctl reload NetworkManager 2>/dev/null || systemctl restart NetworkManager
systemctl start party-box.service 2>/dev/null || true

echo ""
echo "=============================================="
echo " GOTOWE — po resecie prądu (poczekaj ~2 min):"
echo "   http://10.42.0.1        (hotspot PartBox-Gry)"
echo "   http://partygames.pb    (po DNS, ten sam Wi‑Fi)"
echo " Log boot: ~/pi/party-boot.log"
echo " Status:   sudo systemctl status party-box"
echo "=============================================="
