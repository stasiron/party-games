#!/usr/bin/env bash
set -euo pipefail
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.npm-global/bin:$PATH"

chmod +x "$HOME/pi/"*.sh
pm2 delete party-front 2>/dev/null || true
pkill -f 'serve.*dist' 2>/dev/null || true
sleep 1
bash "$HOME/pi/fix-web.sh"
pm2 describe firebase-db >/dev/null 2>&1 || pm2 start "$HOME/pi/ecosystem.config.cjs" --only firebase-db
pm2 save
pm2 list
echo ""
echo "Pełny autostart po resecie prądu (1× sudo):"
echo "  sudo bash ~/pi/setup-boot-sudo.sh"
