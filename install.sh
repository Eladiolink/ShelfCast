#!/usr/bin/env bash
#
# ShelfCast — instalador para Linux
# Verifica dependências, instala, configura o serviço systemd e inicia.
#
set -euo pipefail

APP_NAME="shelfcast"
INSTALL_DIR="/opt/${APP_NAME}"
SERVICE_NAME="${APP_NAME}"
PORT_DEFAULT=8080

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

info()  { echo -e "${BLUE}ℹ${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*"; }

# ---------------------------------------------------------------
# 0. Detectar usuário/sudo
# ---------------------------------------------------------------
if [[ "$(id -u)" -eq 0 ]]; then
  RUN_USER="$(logname 2>/dev/null || echo root)"
  SUDO=""
else
  RUN_USER="$(id -un)"
  SUDO="sudo"
fi

echo ""
echo "  ┌────────────────────────────────────────────┐"
echo "  │            ShelfCast · instalador          │"
echo "  └────────────────────────────────────────────┘"
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
$SUDO mkdir -p "${INSTALL_DIR}"
$SUDO cp -r "${SCRIPT_DIR}/src" "${INSTALL_DIR}/src"
$SUDO cp -r "${SCRIPT_DIR}/public" "${INSTALL_DIR}/public"
$SUDO cp -r "${SCRIPT_DIR}/electron" "${INSTALL_DIR}/electron"
$SUDO cp "${SCRIPT_DIR}/package.json" "${INSTALL_DIR}/package.json"
$SUDO cp "${SCRIPT_DIR}/.env.example" "${INSTALL_DIR}/.env.example"
$SUDO cp -r "${SCRIPT_DIR}/systemd" "${INSTALL_DIR}/systemd"
$SUDO cp -r "${SCRIPT_DIR}/test" "${INSTALL_DIR}/test" 2>/dev/null || true

# ---------------------------------------------------------------
# 3. Criar diretórios e configuração padrão
# ---------------------------------------------------------------
DATA_DIR="${INSTALL_DIR}/data"
$SUDO mkdir -p "${DATA_DIR}"/{posters,backdrops,thumbnails,cache,logs}
$SUDO chown -R "${RUN_USER}:${RUN_USER}" "${INSTALL_DIR}" "${DATA_DIR}"

# ---------------------------------------------------------------
# 3a. Migração de instalação anterior (media-library)
# ---------------------------------------------------------------
LEGACY_DIR="/opt/media-library"
if [[ -d "${LEGACY_DIR}" && -f "${LEGACY_DIR}/.env" ]]; then
  info "Instalação anterior encontrada em ${LEGACY_DIR} — migrando…"
  if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
    $SUDO cp "${LEGACY_DIR}/.env" "${INSTALL_DIR}/.env"
    ok "Configuração (.env) migrada"
  fi
  if [[ -d "${LEGACY_DIR}/data" ]]; then
    $SUDO cp -rn "${LEGACY_DIR}/data/." "${INSTALL_DIR}/data/"
    $SUDO chown -R "${RUN_USER}:${RUN_USER}" "${INSTALL_DIR}/data"
    ok "Dados (biblioteca, pôsteres, cache) migrados"
  fi
  if [[ -f "/etc/systemd/system/media-library.service" ]]; then
    warn "Removendo serviço antigo media-library…"
    $SUDO systemctl disable --now media-library 2>/dev/null || true
    $SUDO rm -f "/etc/systemd/system/media-library.service"
    $SUDO rm -f /var/log/media-library.log
    $SUDO rm -f /usr/share/applications/media-library.desktop /usr/local/bin/media-library
    $SUDO rm -f "/usr/share/icons/hicolor/256x256/apps/media-library.png"
  fi
fi

if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  $SUDO cp "${INSTALL_DIR}/.env.example" "${INSTALL_DIR}/.env"
  ok "Configuração padrão criada (.env)"
else
  ok ".env já existe, mantido"
fi
$SUDO chown "${RUN_USER}:${RUN_USER}" "${INSTALL_DIR}/.env"

# ---------------------------------------------------------------
# 3b. Dependências (Electron — app desktop)
# ---------------------------------------------------------------
info "Instalando dependências do app desktop (Electron)…"
if $SUDO -u "${RUN_USER}" npm install --prefix "${INSTALL_DIR}" --no-audit --no-fund --loglevel=error; then
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
    $SUDO rm -rf "${ELECTRON_DIR}/dist"
    $SUDO cp -r "${SCRIPT_DIR}/node_modules/electron/dist" "${ELECTRON_DIR}/dist"
    $SUDO cp "${SCRIPT_DIR}/node_modules/electron/path.txt" "${ELECTRON_DIR}/path.txt"
    ok "Binário copiado do repositório"
  else
    $SUDO -u "${RUN_USER}" node "${ELECTRON_DIR}/install.js" 2>/dev/null || true
    if [[ ! -x "${ELECTRON_DIR}/dist/electron" ]]; then
      warn "Electron não foi baixado — o atalho do app desktop não abrirá."
    fi
  fi
fi

# ---------------------------------------------------------------
# 4. Configurar serviço systemd
# ---------------------------------------------------------------
SERVICE_UNIT="${SERVICE_NAME}.service"
SERVICE_FILE="/etc/systemd/system/${SERVICE_UNIT}"

info "Instalando serviço systemd (${SERVICE_UNIT})…"
$SUDO bash -c "cat > ${SERVICE_FILE}" <<EOF
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
User=${RUN_USER}
Group=${RUN_USER}
StandardOutput=append:/var/log/shelfcast.log
StandardError=append:/var/log/shelfcast.log
Environment=NODE_ENV=production
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

$SUDO mkdir -p /var/log
$SUDO touch /var/log/shelfcast.log
$SUDO chown "${RUN_USER}:${RUN_USER}" /var/log/shelfcast.log
$SUDO systemctl daemon-reload
$SUDO systemctl enable "${SERVICE_UNIT}"

# ---------------------------------------------------------------
# 4b. Atalho no menu de aplicativos (app desktop)
# ---------------------------------------------------------------
info "Criando atalho no menu de aplicativos…"
$SUDO mkdir -p /usr/share/icons/hicolor/256x256/apps
$SUDO cp "${SCRIPT_DIR}/electron/assets/icon.png" "/usr/share/icons/hicolor/256x256/apps/${APP_NAME}.png"
$SUDO bash -c "cat > /usr/share/applications/${APP_NAME}.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=ShelfCast
GenericName=ShelfCast
Comment=Galeria web de mídias DLNA
Exec=/usr/local/bin/${APP_NAME}
Icon=${APP_NAME}
Terminal=false
Categories=AudioVideo;Video;Player;
StartupNotify=true
EOF
$SUDO bash -c "cat > /usr/local/bin/${APP_NAME}" <<EOF
#!/usr/bin/env bash
exec /usr/bin/node ${INSTALL_DIR}/node_modules/.bin/electron ${INSTALL_DIR}/electron/main.js
EOF
$SUDO chmod +x "/usr/local/bin/${APP_NAME}"
ok "Atalho criado (procure por \"ShelfCast\" no menu)"

# ---------------------------------------------------------------
# 5. Iniciar aplicação
# ---------------------------------------------------------------
info "Iniciando a aplicação…"
$SUDO systemctl restart "${SERVICE_UNIT}"

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
  warn "A aplicação pode ainda estar subindo. Verifique: systemctl status ${SERVICE_UNIT}"
fi

echo ""
echo "  ✓ Aplicação instalada"
echo ""
echo "  Acesse:"
echo ""
echo "  http://localhost:${PORT_DEFAULT}"
echo ""
echo "  Gerenciar:  systemctl status ${SERVICE_UNIT}"
echo "  Logs:       journalctl -u ${SERVICE_UNIT} -f"
echo ""
