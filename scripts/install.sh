#!/usr/bin/env bash
#
# install.sh — Build and install FAM on macOS or Linux.
#
# Usage:
#   ./scripts/install.sh              # Install to /usr/local/bin (may need sudo)
#   ./scripts/install.sh --prefix ~   # Install to ~/bin
#   ./scripts/install.sh --help
#
# What this does:
#   1. Checks prerequisites (Node.js >= 22, npm)
#   2. Installs dependencies (npm ci)
#   3. Builds the project (npm run build)
#   4. Copies dist/ and node_modules to the install directory
#   5. Creates a `fam` symlink on PATH
#   6. Creates ~/.fam/ data directory
#

set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────

PREFIX="/usr/local"
FAM_HOME="$HOME/.fam"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
DIM='\033[2m'
RESET='\033[0m'

# ─── Parse Arguments ─────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix)
      PREFIX="$2"
      shift 2
      ;;
    --prefix=*)
      PREFIX="${1#*=}"
      shift
      ;;
    --help|-h)
      echo "Usage: ./scripts/install.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --prefix <dir>   Install prefix (default: /usr/local)"
      echo "                   Binary goes to <prefix>/bin/fam"
      echo "                   Library goes to <prefix>/lib/fam/"
      echo "  --help           Show this help"
      echo ""
      echo "Examples:"
      echo "  ./scripts/install.sh                  # /usr/local/bin/fam"
      echo "  ./scripts/install.sh --prefix ~       # ~/bin/fam"
      echo "  sudo ./scripts/install.sh             # System-wide install"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${RESET}"
      exit 1
      ;;
  esac
done

# Expand tilde
PREFIX="${PREFIX/#\~/$HOME}"

BIN_DIR="$PREFIX/bin"
LIB_DIR="$PREFIX/lib/fam"

# ─── Helpers ─────────────────────────────────────────────────────

info()  { echo -e "${GREEN}[+]${RESET} $1"; }
warn()  { echo -e "${YELLOW}[!]${RESET} $1"; }
fail()  { echo -e "${RED}[x]${RESET} $1"; exit 1; }
dim()   { echo -e "${DIM}    $1${RESET}"; }

# ─── Prerequisites ───────────────────────────────────────────────

info "Checking prerequisites..."

if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install Node.js >= 22: https://nodejs.org/"
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_VERSION" -lt 22 ]]; then
  fail "Node.js >= 22 required (found v$(node -v)). Update: https://nodejs.org/"
fi
dim "Node.js $(node -v)"

if ! command -v npm &>/dev/null; then
  fail "npm not found. It should come with Node.js."
fi
dim "npm $(npm -v)"

# ─── Build ───────────────────────────────────────────────────────

info "Installing dependencies..."
cd "$PROJECT_ROOT"
npm ci --ignore-scripts 2>&1 | tail -1

info "Building FAM..."
npm run build 2>&1 | tail -1

if [[ ! -f "$PROJECT_ROOT/dist/index.js" ]]; then
  fail "Build failed: dist/index.js not found"
fi
dim "Build complete: dist/index.js"

# ─── Install ─────────────────────────────────────────────────────

info "Installing to $LIB_DIR ..."

# Create directories
mkdir -p "$BIN_DIR" "$LIB_DIR"

# Copy dist and package files
cp -r "$PROJECT_ROOT/dist" "$LIB_DIR/"
cp "$PROJECT_ROOT/package.json" "$LIB_DIR/"
cp "$PROJECT_ROOT/package-lock.json" "$LIB_DIR/" 2>/dev/null || true

# Install production dependencies only
cd "$LIB_DIR"
npm ci --omit=dev --ignore-scripts 2>&1 | tail -1
cd "$PROJECT_ROOT"

# Make the entry point executable
chmod +x "$LIB_DIR/dist/index.js"

# Create wrapper script (more robust than symlink for ESM + shebang)
if [[ -L "$BIN_DIR/fam" || -f "$BIN_DIR/fam" ]]; then
  warn "Replacing existing $BIN_DIR/fam"
  rm -f "$BIN_DIR/fam"
fi

cat > "$BIN_DIR/fam" << WRAPPER
#!/usr/bin/env bash
exec node "$LIB_DIR/dist/index.js" "\$@"
WRAPPER
chmod +x "$BIN_DIR/fam"
dim "Wrapper: $BIN_DIR/fam -> node $LIB_DIR/dist/index.js"

# ─── Data Directory ──────────────────────────────────────────────

info "Creating data directory at $FAM_HOME ..."
mkdir -p "$FAM_HOME"
chmod 700 "$FAM_HOME"

# If running as root (sudo), fix ownership so the real user can access ~/.fam
# and the lib directory. Without this, files end up owned by root and
# `fam init` / `fam knowledge set` fail with EACCES.
if [[ "$EUID" -eq 0 && -n "$SUDO_USER" ]]; then
  REAL_USER="$SUDO_USER"
  REAL_HOME=$(eval echo "~$REAL_USER")
  REAL_FAM_HOME="$REAL_HOME/.fam"

  if [[ -d "$REAL_FAM_HOME" ]]; then
    info "Fixing ownership of $REAL_FAM_HOME for $REAL_USER ..."
    chown -R "$REAL_USER" "$REAL_FAM_HOME"
  fi

  # Also fix the lib dir so npm can read it
  if [[ -d "$LIB_DIR" ]]; then
    chmod -R a+rX "$LIB_DIR"
  fi
fi

# ─── PATH Check ──────────────────────────────────────────────────

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
  warn "$BIN_DIR is not in your PATH."
  echo ""

  SHELL_NAME=$(basename "$SHELL")
  case "$SHELL_NAME" in
    zsh)
      RC_FILE="$HOME/.zshrc"
      ;;
    bash)
      if [[ -f "$HOME/.bash_profile" ]]; then
        RC_FILE="$HOME/.bash_profile"
      else
        RC_FILE="$HOME/.bashrc"
      fi
      ;;
    fish)
      RC_FILE="$HOME/.config/fish/config.fish"
      ;;
    *)
      RC_FILE="$HOME/.profile"
      ;;
  esac

  if [[ "$SHELL_NAME" == "fish" ]]; then
    EXPORT_LINE="set -gx PATH $BIN_DIR \$PATH"
  else
    EXPORT_LINE="export PATH=\"$BIN_DIR:\$PATH\""
  fi

  echo -e "  Add this to ${GREEN}$RC_FILE${RESET}:"
  echo ""
  echo "    $EXPORT_LINE"
  echo ""
  echo -e "  Then run: ${DIM}source $RC_FILE${RESET}"
  echo ""
fi

# ─── Verify ──────────────────────────────────────────────────────

if command -v fam &>/dev/null; then
  FAM_VERSION=$(fam --version 2>/dev/null || echo "unknown")
  info "FAM $FAM_VERSION installed successfully."
else
  info "FAM installed to $BIN_DIR/fam"
  warn "Restart your shell or update PATH to use 'fam' globally."
fi

echo ""
echo -e "${GREEN}Get started:${RESET}"
echo "  fam init              # Create fam.yaml"
echo "  fam --help            # All commands"
echo ""
