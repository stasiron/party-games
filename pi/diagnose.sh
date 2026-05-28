#!/usr/bin/env bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.npm-global/bin:$PATH"

echo "=== IPs ==="
hostname -I

echo "=== PM2 ==="
pm2 list

echo "=== Ports 80 / 9000 ==="
ss -tlnp 2>/dev/null | grep -E ':80|:9000' || netstat -tlnp 2>/dev/null | grep -E ':80|:9000'

echo "=== DNS config ==="
ls -la /etc/NetworkManager/dnsmasq-shared.d/ 2>&1
cat /etc/NetworkManager/dnsmasq-shared.d/partygames.conf 2>&1

echo "=== party-web errors ==="
tail -20 "$HOME/.pm2/logs/party-web-error.log" 2>/dev/null || echo "(brak)"

echo "=== partbox-sync errors ==="
tail -20 "$HOME/.pm2/logs/partbox-sync-error.log" 2>/dev/null || echo "(brak)"

echo "=== HTTP test ==="
command -v curl >/dev/null && curl -s -o /dev/null -w "10.42.0.1:80 -> %{http_code}\n" http://10.42.0.1/ || echo "curl brak"

echo "=== PM2 startup ==="
systemctl --user is-enabled pm2-stas 2>/dev/null || echo "pm2-stas user service: nie"
loginctl show-user "$(whoami)" -p Linger 2>/dev/null || true
