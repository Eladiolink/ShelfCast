#!/usr/bin/env bash
#
# Media Library — instalador para Linux
# Verifica dependências, instala, configura o serviço systemd e inicia.
#
set -euo pipefail

APP_NAME="media-library"
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
echo "  │           Media Library · instalador       │"
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

if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  $SUDO cp "${INSTALL_DIR}/.env.example" "${INSTALL_DIR}/.env"
  ok "Configuração padrão criada (.env)"
else
  ok ".env já existe, mantido"
fi

# ---------------------------------------------------------------
# 4. Configurar serviço systemd
# ---------------------------------------------------------------
SERVICE_UNIT="${SERVICE_NAME}.service"
SERVICE_FILE="/etc/systemd/system/${SERVICE_UNIT}"

info "Instalando serviço systemd (${SERVICE_UNIT})…"
$SUDO bash -c "cat > ${SERVICE_FILE}" <<EOF
[Unit]
Description=Media Library — galeria web de mídias DLNA
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
StandardOutput=append:/var/log/media-library.log
StandardError=append:/var/log/media-library.log
Environment=NODE_ENV=production
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

$SUDO mkdir -p /var/log
$SUDO touch /var/log/media-library.log
$SUDO chown "${RUN_USER}:${RUN_USER}" /var/log/media-library.log
$SUDO systemctl daemon-reload
$SUDO systemctl enable "${SERVICE_UNIT}"

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
