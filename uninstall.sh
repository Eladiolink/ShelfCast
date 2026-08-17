#!/usr/bin/env bash
#
# ShelfCast — desinstalador para Linux (por usuário)
# Remove o serviço systemd de usuário, os arquivos instalados em
# ~/.var/shelfcast e os atalhos. O diretório de dados (biblioteca, cache,
# pôsteres) é mantido por padrão; use --purge para apagar tudo.
#
set -euo pipefail

APP_NAME="shelfcast"
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

# ---------------------------------------------------------------
# 0. Detectar usuário/diretórios
# ---------------------------------------------------------------
if [[ "$(id -u)" -eq 0 ]]; then
  RUN_USER="$(logname 2>/dev/null || echo root)"
  RUN_AS_ROOT=1
else
  RUN_USER="$(id -un)"
  RUN_AS_ROOT=0
fi
USER_HOME="$(getent passwd "${RUN_USER}" | cut -d: -f6)"
INSTALL_DIR="${USER_HOME}/.var/${APP_NAME}"
LOCAL_BIN="${USER_HOME}/.local/bin"
LOCAL_APPS="${USER_HOME}/.local/share/applications"
LOCAL_ICONS="${USER_HOME}/.local/share/icons/hicolor/256x256/apps"
SYSTEMD_USER_DIR="${USER_HOME}/.config/systemd/user"

# systemctl --user, funcional mesmo quando o desinstalador roda com sudo
systemctl_user() {
  if [[ "${RUN_AS_ROOT}" -eq 1 ]]; then
    local uid
    uid="$(id -u "${RUN_USER}")"
    if [[ ! -d "/run/user/${uid}" ]]; then
      mkdir -p "/run/user/${uid}"
      chown "${RUN_USER}:${RUN_USER}" "/run/user/${uid}"
      chmod 700 "/run/user/${uid}"
    fi
    sudo -u "${RUN_USER}" XDG_RUNTIME_DIR="/run/user/${uid}" systemctl --user "$@"
  else
    systemctl --user "$@"
  fi
}

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
# 1. Parar e remover o serviço systemd de usuário
# ---------------------------------------------------------------
if [[ -f "${SYSTEMD_USER_DIR}/${SERVICE_NAME}.service" ]]; then
  info "Parando e removendo o serviço systemd de usuário…"
  systemctl_user disable --now "${SERVICE_NAME}" 2>/dev/null || \
    systemctl_user stop "${SERVICE_NAME}" 2>/dev/null || true
  rm -f "${SYSTEMD_USER_DIR}/${SERVICE_NAME}.service"
  systemctl_user daemon-reload 2>/dev/null || true
  ok "Serviço ${SERVICE_NAME} removido."
else
  info "Serviço systemd de usuário não encontrado, ignorando."
fi

# ---------------------------------------------------------------
# 2. Remover arquivos da aplicação
# ---------------------------------------------------------------
if [[ -d "${INSTALL_DIR}" ]]; then
  info "Removendo ${INSTALL_DIR}…"
  if [[ "${PURGE}" -eq 1 ]]; then
    rm -rf "${INSTALL_DIR}"
  else
    # Mantém data/ (biblioteca e cache); apaga o resto
    if [[ -d "${INSTALL_DIR}/data" ]]; then
      find "${INSTALL_DIR}" -mindepth 1 -maxdepth 1 ! -name data -exec rm -rf {} +
    else
      rm -rf "${INSTALL_DIR}"
    fi
  fi
  ok "Arquivos removidos."
else
  info "Diretório ${INSTALL_DIR} não encontrado, ignorando."
fi

# ---------------------------------------------------------------
# 3. Remover atalhos
# ---------------------------------------------------------------
if [[ -f "${LOCAL_APPS}/${APP_NAME}.desktop" ]]; then
  rm -f "${LOCAL_APPS}/${APP_NAME}.desktop"
  ok "Atalho do menu removido."
fi
rm -f "${LOCAL_BIN}/${APP_NAME}"
rm -f "${LOCAL_ICONS}/${APP_NAME}.png"

# ---------------------------------------------------------------
# 4. Resquícios de instalações antigas em /opt (exige sudo)
# ---------------------------------------------------------------
if [[ "${RUN_AS_ROOT}" -eq 1 ]]; then
  if [[ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]]; then
    info "Removendo serviço antigo em /etc/systemd/system…"
    systemctl disable --now "${SERVICE_NAME}" 2>/dev/null || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    rm -f /var/log/${SERVICE_NAME}.log
    rm -f "/usr/share/applications/${SERVICE_NAME}.desktop" "/usr/local/bin/${SERVICE_NAME}"
    rm -f "/usr/share/icons/hicolor/256x256/apps/${SERVICE_NAME}.png"
    systemctl daemon-reload
  fi
  if [[ -f "/etc/systemd/system/media-library.service" ]]; then
    info "Removendo serviço antigo media-library…"
    systemctl disable --now media-library 2>/dev/null || true
    rm -f "/etc/systemd/system/media-library.service"
  fi
  rm -f /var/log/media-library.log
  rm -f /usr/share/applications/media-library.desktop /usr/local/bin/media-library
  rm -f "/usr/share/icons/hicolor/256x256/apps/media-library.png"
  if [[ -d "/opt/${APP_NAME}" ]]; then
    warn "/opt/${APP_NAME} ainda existe (instalação antiga) — remova com: sudo rm -rf /opt/${APP_NAME}"
  fi
else
  if [[ -d "/opt/${APP_NAME}" || -f "/etc/systemd/system/${SERVICE_NAME}.service" ]]; then
    warn "Resquícios da instalação antiga em /opt — rode o desinstalador com sudo para limpá-los."
  fi
fi

echo ""
if [[ "${PURGE}" -eq 1 ]]; then
  ok "Desinstalação completa (--purge)."
else
  ok "Desinstalação concluída."
  echo "  Seus dados ficaram em ${INSTALL_DIR}/data — apague manualmente"
  echo "  quando quiser, ou rode novamente com --purge."
fi
echo ""
info "Linger ainda está ativo para ${RUN_USER} (afeta qualquer serviço de usuário)."
info "Para desativar: loginctl disable-linger ${RUN_USER}"
echo ""