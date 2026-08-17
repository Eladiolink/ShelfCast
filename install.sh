#!/usr/bin/env bash
#
# ShelfCast — instalador para Linux (por usuário, sem sudo)
# Instala em ~/.var/shelfcast, configura o serviço systemd de usuário e inicia.
# Se executado com sudo, instala para o usuário logado.
#
set -euo pipefail

APP_NAME="shelfcast"
SERVICE_NAME="${APP_NAME}"
PORT_DEFAULT=8080

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

info()  { echo -e "${BLUE}ℹ${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*"; }

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
DATA_DIR="${INSTALL_DIR}/data"
LOCAL_BIN="${USER_HOME}/.local/bin"
LOCAL_APPS="${USER_HOME}/.local/share/applications"
LOCAL_ICONS="${USER_HOME}/.local/share/icons/hicolor/256x256/apps"
SYSTEMD_USER_DIR="${USER_HOME}/.config/systemd/user"
LOG_FILE="${DATA_DIR}/logs/${APP_NAME}.log"

# Executa um comando como o usuário dono da instalação (necessário com sudo)
run_as_user() {
  if [[ "${RUN_AS_ROOT}" -eq 1 ]]; then
    sudo -u "${RUN_USER}" HOME="${USER_HOME}" "$@"
  else
    "$@"
  fi
}

# systemctl --user, funcional mesmo quando o instalador roda com sudo
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
echo "  │            ShelfCast · instalador          │"
echo "  └────────────────────────────────────────────┘"
echo ""
info "Usuário: ${RUN_USER}"
info "Destino: ${INSTALL_DIR}"
echo ""

# ---------------------------------------------------------------
# 1. Verificar dependências
# ---------------------------------------------------------------
info "Verificando dependências..."

need() {
  if command -v "$1" >/dev/null 2>&1; then
    ok "$1 instalado"
    return 0
  fi
  warn "$1 NÃO encontrado"
  return 1
}

NODE_OK=0
need node && NODE_OK=1
if [[ "$NODE_OK" -eq 1 ]]; then
  NODE_VER="$(node -v | tr -d 'v')"
  if [[ "$(printf '%s\n' "$NODE_VER" 22.5 | sort -V | head -1)" == "$NODE_VER" ]]; then
    err "Node.js muito antigo (>=22.5 recomendado). Atualize e rode novamente."
    exit 1
  fi
fi
need ffmpeg || warn "FFmpeg ausente — reprodução direta funciona, transcodificação ficará desativada."

# ---------------------------------------------------------------
# 2. Copiar aplicação
# ---------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
info "Copiando arquivos para ${INSTALL_DIR}…"
mkdir -p "${INSTALL_DIR}"
cp -r "${SCRIPT_DIR}/src" "${INSTALL_DIR}/src"
cp -r "${SCRIPT_DIR}/public" "${INSTALL_DIR}/public"
cp -r "${SCRIPT_DIR}/electron" "${INSTALL_DIR}/electron"
cp "${SCRIPT_DIR}/package.json" "${INSTALL_DIR}/package.json"
cp "${SCRIPT_DIR}/.env.example" "${INSTALL_DIR}/.env.example"
cp -r "${SCRIPT_DIR}/systemd" "${INSTALL_DIR}/systemd"
cp -r "${SCRIPT_DIR}/test" "${INSTALL_DIR}/test" 2>/dev/null || true

# ---------------------------------------------------------------
# 3. Criar diretórios e configuração padrão
# ---------------------------------------------------------------
mkdir -p "${DATA_DIR}"/{posters,backdrops,thumbnails,cache,logs}

# ---------------------------------------------------------------
# 3a. Migração de instalações anteriores
# ---------------------------------------------------------------
LEGACY_DIR="/opt/media-library"
OLD_DIR="/opt/${APP_NAME}"
if [[ "${RUN_AS_ROOT}" -eq 1 ]]; then
  # Migração de /opt/media-library (versão antiga do app)
  if [[ -d "${LEGACY_DIR}" && -f "${LEGACY_DIR}/.env" ]]; then
    info "Instalação anterior encontrada em ${LEGACY_DIR} — migrando…"
    if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
      cp "${LEGACY_DIR}/.env" "${INSTALL_DIR}/.env"
      ok "Configuração (.env) migrada"
    fi
    if [[ -d "${LEGACY_DIR}/data" ]]; then
      cp -rn "${LEGACY_DIR}/data/." "${DATA_DIR}/"
      ok "Dados (biblioteca, pôsteres, cache) migrados"
    fi
    if [[ -f "/etc/systemd/system/media-library.service" ]]; then
      warn "Removendo serviço antigo media-library…"
      systemctl disable --now media-library 2>/dev/null || true
      rm -f "/etc/systemd/system/media-library.service"
      rm -f /var/log/media-library.log
      rm -f /usr/share/applications/media-library.desktop /usr/local/bin/media-library
      rm -f "/usr/share/icons/hicolor/256x256/apps/media-library.png"
    fi
  fi
  # Migração de /opt/shelfcast (versão anterior deste instalador)
  if [[ -d "${OLD_DIR}" ]]; then
    info "Instalação anterior encontrada em ${OLD_DIR} — migrando…"
    if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
      cp "${OLD_DIR}/.env" "${INSTALL_DIR}/.env"
      ok "Configuração (.env) migrada"
    fi
    if [[ -d "${OLD_DIR}/data" ]]; then
      cp -rn "${OLD_DIR}/data/." "${DATA_DIR}/"
      ok "Dados (biblioteca, pôsteres, cache) migrados"
    fi
    if [[ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]]; then
      warn "Removendo serviço antigo em /etc/systemd/system…"
      systemctl disable --now "${SERVICE_NAME}" 2>/dev/null || true
      rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
      rm -f /var/log/${SERVICE_NAME}.log
      rm -f "/usr/share/applications/${SERVICE_NAME}.desktop" "/usr/local/bin/${SERVICE_NAME}"
      rm -f "/usr/share/icons/hicolor/256x256/apps/${SERVICE_NAME}.png"
    fi
    warn "${OLD_DIR} ainda existe — remova manualmente: sudo rm -rf ${OLD_DIR}"
  fi
else
  if [[ -d "${LEGACY_DIR}" || -d "${OLD_DIR}" ]]; then
    warn "Instalação anterior detectada em /opt — rode o instalador com sudo uma vez para migrá-la."
  fi
fi

if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  cp "${INSTALL_DIR}/.env.example" "${INSTALL_DIR}/.env"
  ok "Configuração padrão criada (.env)"
else
  ok ".env já existe, mantido"
fi

if [[ "${RUN_AS_ROOT}" -eq 1 ]]; then
  chown -R "${RUN_USER}:${RUN_USER}" "${INSTALL_DIR}" "${DATA_DIR}"
fi

# ---------------------------------------------------------------
# 3b. Dependências (Electron — app desktop)
# ---------------------------------------------------------------
info "Instalando dependências do app desktop (Electron)…"
if run_as_user npm install --prefix "${INSTALL_DIR}" --no-audit --no-fund --loglevel=error; then
  ok "Dependências instaladas"
else
  warn "npm install falhou — o atalho do app desktop não abrirá."
fi

ELECTRON_DIR="${INSTALL_DIR}/node_modules/electron"
# O npm pode bloquear o script pós-instalação do Electron (que baixa o binário).
# Se faltar o binário, copia do clone do repositório (se existir) ou baixa manualmente.
if [[ ! -x "${ELECTRON_DIR}/dist/electron" ]]; then
  info "Binário do Electron ausente — recuperando…"
  if [[ -x "${SCRIPT_DIR}/node_modules/electron/dist/electron" ]]; then
    rm -rf "${ELECTRON_DIR}/dist"
    cp -r "${SCRIPT_DIR}/node_modules/electron/dist" "${ELECTRON_DIR}/dist"
    cp "${SCRIPT_DIR}/node_modules/electron/path.txt" "${ELECTRON_DIR}/path.txt"
    ok "Binário copiado do repositório"
  else
    run_as_user node "${ELECTRON_DIR}/install.js" 2>/dev/null || true
    if [[ ! -x "${ELECTRON_DIR}/dist/electron" ]]; then
      warn "Electron não foi baixado — o atalho do app desktop não abrirá."
    fi
  fi
fi

# ---------------------------------------------------------------
# 4. Configurar serviço systemd (usuário)
# ---------------------------------------------------------------
SERVICE_UNIT="${SERVICE_NAME}.service"
SERVICE_FILE="${SYSTEMD_USER_DIR}/${SERVICE_UNIT}"

info "Instalando serviço systemd de usuário (${SERVICE_UNIT})…"
mkdir -p "${SYSTEMD_USER_DIR}"
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=ShelfCast — galeria web de mídias DLNA
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/node ${INSTALL_DIR}/src/index.js
WorkingDirectory=${INSTALL_DIR}
Restart=on-failure
RestartSec=5
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}
Environment=NODE_ENV=production
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
EOF

# Inicia o serviço automaticamente no boot, mesmo sem login do usuário
if ! loginctl show-user "${RUN_USER}" -p Linger --value 2>/dev/null | grep -q "^1$"; then
  info "Ativando linger para ${RUN_USER} (serviço inicia no boot)…"
  loginctl enable-linger "${RUN_USER}"
fi

systemctl_user daemon-reload
systemctl_user enable "${SERVICE_UNIT}"

# ---------------------------------------------------------------
# 4b. Atalho no menu de aplicativos (app desktop)
# ---------------------------------------------------------------
info "Criando atalho no menu de aplicativos…"
mkdir -p "${LOCAL_ICONS}" "${LOCAL_APPS}" "${LOCAL_BIN}"
cp "${SCRIPT_DIR}/electron/assets/icon.png" "${LOCAL_ICONS}/${APP_NAME}.png"
cat > "${LOCAL_APPS}/${APP_NAME}.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=ShelfCast
GenericName=ShelfCast
Comment=Galeria web de mídias DLNA
Exec=${LOCAL_BIN}/${APP_NAME}
Icon=${APP_NAME}
Terminal=false
Categories=AudioVideo;Video;Player;
StartupNotify=true
EOF
cat > "${LOCAL_BIN}/${APP_NAME}" <<EOF
#!/usr/bin/env bash
exec /usr/bin/node ${INSTALL_DIR}/node_modules/.bin/electron ${INSTALL_DIR}/electron/main.js
EOF
chmod +x "${LOCAL_BIN}/${APP_NAME}"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "${LOCAL_APPS}" 2>/dev/null || true
ok "Atalho criado (procure por \"ShelfCast\" no menu)"

case ":${PATH}:" in
  *":${LOCAL_BIN}:"*) ;;
  *) warn "~/.local/bin não está no PATH — adicione 'export PATH=\"\$HOME/.local/bin:\$PATH\"' ao ~/.bashrc" ;;
esac

if [[ "${RUN_AS_ROOT}" -eq 1 ]]; then
  chown -R "${RUN_USER}:${RUN_USER}" "${SYSTEMD_USER_DIR}" "${LOCAL_BIN}" "${LOCAL_APPS}" "${LOCAL_ICONS}"
fi

# ---------------------------------------------------------------
# 5. Iniciar aplicação
# ---------------------------------------------------------------
info "Iniciando a aplicação…"
systemctl_user restart "${SERVICE_UNIT}"

for _ in $(seq 1 15); do
  if curl -s -o /dev/null "http://localhost:${PORT_DEFAULT}"; then
    RUNNING=1
    break
  fi
  sleep 1
done

if [[ "${RUNNING:-0}" -eq 1 ]]; then
  ok "Serviço iniciado e respondendo."
else
  warn "A aplicação pode ainda estar subindo. Verifique: systemctl --user status ${SERVICE_UNIT}"
fi

echo ""
echo "  ✓ Aplicação instalada"
echo ""
echo "  Acesse:"
echo ""
echo "  http://localhost:${PORT_DEFAULT}"
echo ""
echo "  Gerenciar:  systemctl --user status ${SERVICE_UNIT}"
echo "  Logs:       journalctl --user -u ${SERVICE_UNIT} -f"
echo "  Desinstalar: ./uninstall.sh"
echo ""