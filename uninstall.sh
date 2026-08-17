#!/usr/bin/env bash
#
# ShelfCast — desinstalador para Linux
# Remove o serviço systemd, os arquivos instalados em /opt/shelfcast
# e os logs. O diretório de dados (biblioteca, cache, pôsteres) é mantido
# por padrão; use --purge para apagar tudo.
#
set -euo pipefail

APP_NAME="shelfcast"
INSTALL_DIR="/opt/${APP_NAME}"
SERVICE_NAME="${APP_NAME}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

info() { echo -e "${BLUE}ℹ${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*"; }

PURGE=0
if [[ "${1:-}" == "--purge" ]]; then
  PURGE=1
fi

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

echo ""
echo "  ┌────────────────────────────────────────────┐"
echo "  │          ShelfCast · desinstalador         │"
echo "  └────────────────────────────────────────────┘"
echo ""
if [[ "${PURGE}" -eq 1 ]]; then
  warn "Modo --purge: TODOS os dados (biblioteca, cache, pôsteres) serão apagados."
else
  info "Os dados em ${INSTALL_DIR}/data serão mantidos."
fi
read -r -p "Tem certeza que deseja desinstalar? [s/N] " CONFIRM
if [[ "${CONFIRM,,}" != "s" && "${CONFIRM,,}" != "y" ]]; then
  echo ""
  err "Desinstalação cancelada."
  exit 1
fi

# ---------------------------------------------------------------
# 1. Parar e remover o serviço systemd
# ---------------------------------------------------------------
if [[ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]]; then
  info "Parando e removendo o serviço systemd…"
  $SUDO systemctl disable --now "${SERVICE_NAME}" 2>/dev/null || \
    $SUDO systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
  $SUDO rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  $SUDO systemctl daemon-reload
  ok "Serviço ${SERVICE_NAME} removido."
else
  info "Serviço systemd não encontrado, ignorando."
fi

# ---------------------------------------------------------------
# 2. Remover arquivos da aplicação
# ---------------------------------------------------------------
if [[ -d "${INSTALL_DIR}" ]]; then
  info "Removendo ${INSTALL_DIR}…"
  if [[ "${PURGE}" -eq 1 ]]; then
    $SUDO rm -rf "${INSTALL_DIR}"
  else
    # Mantém data/ (biblioteca e cache); apaga o resto
    if [[ -d "${INSTALL_DIR}/data" ]]; then
      $SUDO find "${INSTALL_DIR}" -mindepth 1 -maxdepth 1 ! -name data -exec rm -rf {} +
    else
      $SUDO rm -rf "${INSTALL_DIR}"
    fi
  fi
  ok "Arquivos removidos."
else
  info "Diretório ${INSTALL_DIR} não encontrado, ignorando."
fi

# ---------------------------------------------------------------
# 3. Remover atalho do menu
# ---------------------------------------------------------------
if [[ -f "/usr/share/applications/${APP_NAME}.desktop" ]]; then
  $SUDO rm -f "/usr/share/applications/${APP_NAME}.desktop"
  ok "Atalho do menu removido."
fi
$SUDO rm -f "/usr/local/bin/${APP_NAME}"
$SUDO rm -f "/usr/share/icons/hicolor/256x256/apps/${APP_NAME}.png"

# ---------------------------------------------------------------
# 4. Remover logs
# ---------------------------------------------------------------
if [[ -f "/var/log/${APP_NAME}.log" ]]; then
  $SUDO rm -f "/var/log/${APP_NAME}.log"
  ok "Log /var/log/${APP_NAME}.log removido."
fi

# ---------------------------------------------------------------
# 5. Remover resquícios da instalação antiga (media-library)
# ---------------------------------------------------------------
if [[ -f "/etc/systemd/system/media-library.service" ]]; then
  info "Removendo serviço antigo media-library…"
  $SUDO systemctl disable --now media-library 2>/dev/null || true
  $SUDO rm -f "/etc/systemd/system/media-library.service"
fi
$SUDO rm -f /var/log/media-library.log
$SUDO rm -f /usr/share/applications/media-library.desktop /usr/local/bin/media-library
$SUDO rm -f "/usr/share/icons/hicolor/256x256/apps/media-library.png"
$SUDO systemctl daemon-reload 2>/dev/null || true

echo ""
if [[ "${PURGE}" -eq 1 ]]; then
  ok "Desinstalação completa (--purge)."
else
  ok "Desinstalação concluída."
  echo "  Seus dados ficaram em ${INSTALL_DIR}/data — apague manualmente"
  echo "  quando quiser, ou rode novamente com --purge."
fi
echo ""