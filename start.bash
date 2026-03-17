#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════╗
# ║           TestForge — Unified Start Script               ║
# ╚══════════════════════════════════════════════════════════╝

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

banner() {
  echo ""
  echo -e "${CYAN}${BOLD}"
  echo "  ████████╗███████╗███████╗████████╗███████╗ ██████╗ ██████╗  ██████╗ ███████╗"
  echo "     ██╔══╝██╔════╝██╔════╝╚══██╔══╝██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝"
  echo "     ██║   █████╗  ███████╗   ██║   █████╗  ██║   ██║██████╔╝██║  ███╗█████╗  "
  echo "     ██║   ██╔══╝  ╚════██║   ██║   ██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝  "
  echo "     ██║   ███████╗███████║   ██║   ██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗"
  echo "     ╚═╝   ╚══════╝╚══════╝   ╚═╝   ╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝"
  echo -e "${RESET}"
  echo -e "  ${BOLD}AI-Powered Selenium Test Environment Provisioner${RESET}"
  echo ""
}

log()     { echo -e "  ${GREEN}▶${RESET} $1"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET}  $1"; }
err()     { echo -e "  ${RED}✗${RESET}  $1"; exit 1; }
section() { echo ""; echo -e "  ${CYAN}${BOLD}── $1${RESET}"; echo ""; }

banner

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
DEMO_DIR="$ROOT_DIR/demo_project"

# ── Load .env ──────────────────────────────────────────────────────────────────
section "Loading Environment Variables"
ENV_FILE="$ROOT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  set -a; source "$ENV_FILE"; set +a
  log ".env loaded ✓"
  log "  Azure Endpoint:   ${AZURE_OPENAI_ENDPOINT:-not set}"
  log "  Azure Deployment: ${AZURE_OPENAI_DEPLOYMENT:-not set}"
  log "  API Key:          ${AZURE_OPENAI_API_KEY:0:8}... (hidden)"
else
  warn ".env not found"
fi

# ── Check Python & Node ──────────────────────────────────────────────────────
section "Checking Prerequisites"

for cmd in python3 node npm; do
  command -v "$cmd" &>/dev/null \
    && log "$cmd ✓  ($(command -v $cmd))" \
    || err "$cmd not found. Install from https://python.org / https://nodejs.org"
done
log "Python: $(python3 --version)"
log "Node:   $(node --version)"

# ── Check Node / npm ──────────────────────────────────────────────────────────
section "Checking Node.js"
for cmd in node npm; do
  command -v "$cmd" &>/dev/null \
    && log "$cmd ✓  ($(command -v $cmd))" \
    || err "$cmd not found — install from https://nodejs.org"
done

NODE_VER=$(node --version | sed 's/v//')
NODE_MAJOR=${NODE_VER%%.*}
log "Node.js v$NODE_VER detected"
if [ "$NODE_MAJOR" -lt 16 ]; then
  err "Node.js 16+ required. Please upgrade: https://nodejs.org"
fi

# ── Backend Setup ─────────────────────────────────────────────────────────────
section "Setting Up Backend"
cd "$BACKEND_DIR"

# Use system Python (works with Python 3.11, 3.12, 3.13)
log "Installing backend dependencies with system Python..."
pip3 install fastapi "uvicorn[standard]" python-multipart httpx pydantic \
  selenium pytest pytest-html websockets -q

log "Backend dependencies installed ✓  ($(python3 --version))"

# ── Frontend Setup ────────────────────────────────────────────────────────────
section "Setting Up Frontend"
cd "$FRONTEND_DIR"

# Clean install if node_modules exists but seems broken
if [ -d "node_modules" ]; then
  log "Cleaning old node_modules..."
  rm -rf node_modules
fi

log "Installing frontend dependencies (Vite + React)..."
npm install 2>&1 | tail -5

if [ ! -d "node_modules" ]; then
  err "npm install failed. Check your Node.js version (need 16+): node --version"
fi

log "Frontend dependencies installed ✓"

# ── Start Services ────────────────────────────────────────────────────────────
section "Starting Services"

# Kill anything already on these ports
for port in 3000 8000 3001; do
  pid=$(lsof -ti tcp:$port 2>/dev/null || true)
  [ -n "$pid" ] && { warn "Killing existing process on port $port (PID $pid)"; kill "$pid" 2>/dev/null || true; sleep 1; }
done

# Demo app
log "Starting Demo Project on port 3001..."
cd "$DEMO_DIR"
python3 -m http.server 3001 &>/dev/null &
DEMO_PID=$!
log "Demo Project  →  http://localhost:3001  (PID: $DEMO_PID)"

# Backend
log "Starting Backend API on port 8000..."
cd "$BACKEND_DIR"

log "Verifying backend can import..."
if ! python3 -c "import fastapi, uvicorn, httpx, pydantic, websockets" 2>/tmp/tf_import.log; then
  err "Backend import failed:"
  cat /tmp/tf_import.log
  exit 1
fi
log "Import check ✓"

python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload \
  --log-level info \
  >/tmp/testforge_backend.log 2>&1 &
BACKEND_PID=$!
log "Backend API   →  http://localhost:8000  (PID: $BACKEND_PID)"

log "Waiting for backend to be ready..."
READY=0
for i in $(seq 1 25); do
  sleep 1
  if curl -s http://localhost:8000/api/health &>/dev/null; then
    log "Backend ready ✓"
    READY=1
    break
  fi
done
if [ "$READY" -eq 0 ]; then
  echo ""
  warn "Backend did not respond — last 20 lines of log:"
  echo "──────────────────────────────────────────────"
  tail -20 /tmp/testforge_backend.log
  echo "──────────────────────────────────────────────"
  echo ""
  exit 1
fi

# Frontend (Vite)
log "Starting React Frontend on port 3000 (Vite)..."
cd "$FRONTEND_DIR"
npm run start &>/tmp/testforge_frontend.log &
FRONTEND_PID=$!
log "React Dashboard →  http://localhost:3000  (PID: $FRONTEND_PID)"

# Wait for Vite to be ready
log "Waiting for frontend..."
for i in $(seq 1 30); do
  curl -s http://localhost:3000 &>/dev/null && { log "Frontend ready ✓"; break; }
  sleep 1
  [ "$i" -eq 30 ] && warn "Frontend slow — check: tail -f /tmp/testforge_frontend.log"
done

# ── Ready ─────────────────────────────────────────────────────────────────────
section "All Services Running!"
echo -e "  ${GREEN}${BOLD}╔══════════════════════════════════════════════╗${RESET}"
echo -e "  ${GREEN}${BOLD}║  🚀  TestForge is ready!                     ║${RESET}"
echo -e "  ${GREEN}${BOLD}╠══════════════════════════════════════════════╣${RESET}"
echo -e "  ${GREEN}${BOLD}║${RESET}  Dashboard  →  ${CYAN}http://localhost:3000${RESET}          ${GREEN}${BOLD}║${RESET}"
echo -e "  ${GREEN}${BOLD}║${RESET}  Backend    →  ${CYAN}http://localhost:8000${RESET}          ${GREEN}${BOLD}║${RESET}"
echo -e "  ${GREEN}${BOLD}║${RESET}  Demo App   →  ${CYAN}http://localhost:3001${RESET}          ${GREEN}${BOLD}║${RESET}"
echo -e "  ${GREEN}${BOLD}║${RESET}  API Docs   →  ${CYAN}http://localhost:8000/docs${RESET}     ${GREEN}${BOLD}║${RESET}"
echo -e "  ${GREEN}${BOLD}╚══════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${YELLOW}Demo login:${RESET}   demo@test.com  /  password123"
echo -e "  ${YELLOW}Backend log:${RESET}  tail -f /tmp/testforge_backend.log"
echo -e "  ${YELLOW}Frontend log:${RESET} tail -f /tmp/testforge_frontend.log"
echo -e "  ${YELLOW}Stop all:${RESET}     Ctrl+C"
echo ""

cleanup() {
  echo ""
  section "Shutting Down"
  kill "$DEMO_PID" "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  log "All services stopped."
  exit 0
}
trap cleanup INT TERM
wait
