#!/usr/bin/env bash
# Jednorazowo na Malinie (wymaga sudo): domeny partygames.pb itd. bez edycji hosts na telefonach.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_SRC="$SCRIPT_DIR/partygames-dns.conf"
CONF_DST="/etc/NetworkManager/dnsmasq-shared.d/partygames.conf"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Uruchom: sudo bash $0"
  exit 1
fi

install -d /etc/NetworkManager/dnsmasq-shared.d
install -m 644 "$CONF_SRC" "$CONF_DST"

# Lokalnie na Malinie (testy z konsoli)
if ! grep -q 'partygames.pb' /etc/hosts 2>/dev/null; then
  echo "10.42.0.1 partygames.pb party.pb gry.pb partbox.pb" >> /etc/hosts
fi

nmcli connection modify PartBox-Gry connection.autoconnect-priority 100 2>/dev/null || true
systemctl reload NetworkManager || systemctl restart NetworkManager

echo "OK. Po połączeniu z Wi‑Fi PartBox-Gry otwórz: http://partygames.pb"
echo "Domeny: partygames.pb, party.pb, gry.pb, partbox.pb → 10.42.0.1"
