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

info "Compiling native modules..."
npm rebuild better-sqlite3 2>&1 | tail -1

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

# Install production dependencies (must allow scripts for native modules like better-sqlite3)
# Pin the exact Node binary path so the native module matches the runtime.
NODE_BIN="$(which node)"
cd "$LIB_DIR"
npm ci --omit=dev 2>&1 | tail -1
cd "$PROJECT_ROOT"

# Make the entry point executable
chmod +x "$LIB_DIR/dist/index.js"

# Create wrapper script (more robust than symlink for ESM + shebang)
if [[ -L "$BIN_DIR/fam" || -f "$BIN_DIR/fam" ]]; then
  warn "Replacing existing $BIN_DIR/fam"
  rm -f "$BIN_DIR/fam"
fi

# Pin the absolute path to the Node binary used during install.
# This ensures the native modules (better-sqlite3) match the runtime.
NODE_BIN="$(which node)"
dim "Using Node: $NODE_BIN ($(node -v))"

cat > "$BIN_DIR/fam" << WRAPPER
#!/usr/bin/env bash
exec "$NODE_BIN" "$LIB_DIR/dist/index.js" "\$@"
WRAPPER
chmod +x "$BIN_DIR/fam"
dim "Wrapper: $BIN_DIR/fam -> $NODE_BIN $LIB_DIR/dist/index.js"

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

  # Fix the lib dir so npm can read it
  if [[ -d "$LIB_DIR" ]]; then
    chmod -R a+rX "$LIB_DIR"
  fi

  # Fix the source repo's node_modules if it's in the project root
  # (sudo npm ci can leave root-owned files that break subsequent npm commands)
  if [[ -d "$PROJECT_ROOT/node_modules" ]]; then
    info "Fixing ownership of $PROJECT_ROOT/node_modules for $REAL_USER ..."
    chown -R "$REAL_USER" "$PROJECT_ROOT/node_modules"
  fi
fi

# ─── Daemon Auto-Start ───────────────────────────────────────────

OS_TYPE="$(uname -s)"
FAM_BIN="$BIN_DIR/fam"

# Determine the real user (even when running under sudo)
if [[ "$EUID" -eq 0 && -n "$SUDO_USER" ]]; then
  REAL_USER="$SUDO_USER"
  REAL_HOME=$(eval echo "~$REAL_USER")
else
  REAL_USER="$(whoami)"
  REAL_HOME="$HOME"
fi

if [[ "$OS_TYPE" == "Darwin" ]]; then
  PLIST_DIR="$REAL_HOME/Library/LaunchAgents"
  PLIST_PATH="$PLIST_DIR/com.sweetpapatech.fam.plist"

  info "Installing launchd daemon (auto-start on login)..."
  mkdir -p "$PLIST_DIR"

  cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.sweetpapatech.fam</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$LIB_DIR/dist/index.js</string>
    <string>daemon</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$REAL_HOME/.fam/daemon.log</string>
  <key>StandardErrorPath</key><string>$REAL_HOME/.fam/daemon.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/usr/bin:/bin</string>
    <key>FAM_HOME</key><string>$REAL_HOME/.fam</string>
  </dict>
</dict>
</plist>
PLIST

  # Fix ownership if running as root
  if [[ "$EUID" -eq 0 && -n "$SUDO_USER" ]]; then
    chown "$REAL_USER" "$PLIST_PATH"
  fi

  # Unload old version if loaded, then load new
  if launchctl list com.sweetpapatech.fam &>/dev/null; then
    # Run as the real user, not root
    if [[ "$EUID" -eq 0 && -n "$SUDO_USER" ]]; then
      sudo -u "$REAL_USER" launchctl unload "$PLIST_PATH" 2>/dev/null || true
      sudo -u "$REAL_USER" launchctl load "$PLIST_PATH"
    else
      launchctl unload "$PLIST_PATH" 2>/dev/null || true
      launchctl load "$PLIST_PATH"
    fi
  else
    if [[ "$EUID" -eq 0 && -n "$SUDO_USER" ]]; then
      sudo -u "$REAL_USER" launchctl load "$PLIST_PATH"
    else
      launchctl load "$PLIST_PATH"
    fi
  fi

  dim "Installed: $PLIST_PATH"
  dim "Daemon will start automatically on login"
  dim "Logs: $REAL_HOME/.fam/daemon.log"

elif [[ "$OS_TYPE" == "Linux" ]]; then
  UNIT_DIR="$REAL_HOME/.config/systemd/user"
  UNIT_PATH="$UNIT_DIR/fam.service"

  info "Installing systemd user service (auto-start on login)..."
  mkdir -p "$UNIT_DIR"

  cat > "$UNIT_PATH" << UNIT
[Unit]
Description=FAM - FoFo Agent Manager Daemon
After=network.target

[Service]
ExecStart=$NODE_BIN $LIB_DIR/dist/index.js daemon start --foreground
Restart=on-failure
RestartSec=5
Environment=FAM_HOME=$REAL_HOME/.fam

[Install]
WantedBy=default.target
UNIT

  if [[ "$EUID" -eq 0 && -n "$SUDO_USER" ]]; then
    chown "$REAL_USER" "$UNIT_PATH"
    sudo -u "$REAL_USER" systemctl --user daemon-reload
    sudo -u "$REAL_USER" systemctl --user enable fam
    sudo -u "$REAL_USER" systemctl --user restart fam
  else
    systemctl --user daemon-reload
    systemctl --user enable fam
    systemctl --user restart fam
  fi

  dim "Installed: $UNIT_PATH"
  dim "Daemon enabled and started"
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
echo "  fam plan              # Preview changes"
echo "  fam apply             # Apply configuration"
echo "  fam daemon status     # Check daemon is running"
echo "  fam --help            # All commands"
echo ""
