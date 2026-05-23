#!/usr/bin/env bash
set -euo pipefail
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.npm-global/bin:$PATH"

echo "serve: $(command -v serve)"
pm2 delete party-web 2>/dev/null || true
pkill -f 'serve.*dist' 2>/dev/null || true
sleep 1

# Pełna ścieżka + shell — stabilniejsze niż interpreter: none
pm2 start "$(command -v serve)" \
  --name party-web \
  --cwd /home/stas \
  -- -s /home/stas/dist -l tcp://0.0.0.0:80

sleep 2
pm2 list
ss -tlnp | grep ':80' || { echo "BŁĄD: port 80 nie nasłuchuje"; tail -30 ~/.pm2/logs/party-web-error.log; exit 1; }
pm2 save
echo "OK: strona na porcie 80"
