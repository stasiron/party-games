#!/usr/bin/env bash
# Skrót: jedna komenda na Malinie (najpierw skopiuj folder pi/ na ~/pi).
#   bash ~/pi/install-once.sh          # bez sudo — tylko PM2
#   sudo bash ~/pi/setup-boot-sudo.sh  # pełny autostart + DNS (hasło 1×)
set -euo pipefail
echo "Krok A (użytkownik): PM2 strona + baza"
bash "$(dirname "$0")/remote-install.sh"
echo ""
echo "Krok B (root, jednorazowo):"
echo "  sudo bash $(dirname "$0")/setup-boot-sudo.sh"
echo ""
echo "Potem test: odłącz prąd → włącz → po 2 min http://10.42.0.1"
