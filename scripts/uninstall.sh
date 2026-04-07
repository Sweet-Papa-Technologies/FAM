#!/usr/bin/env bash
#
# uninstall.sh — Remove FAM from macOS or Linux.
#
# Usage:
#   ./scripts/uninstall.sh              # Uninstall from /usr/local
#   ./scripts/uninstall.sh --prefix ~   # Uninstall from ~/
#   ./scripts/uninstall.sh --all        # Also remove ~/.fam data
#

set -euo pipefail

PREFIX="/usr/local"
REMOVE_DATA=false

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
DIM='\033[2m'
RESET='\033[0m'

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix)   PREFIX="$2"; shift 2 ;;
    --prefix=*) PREFIX="${1#*=}"; shift ;;
    --all)      REMOVE_DATA=true; shift ;;
    --help|-h)
      echo "Usage: ./scripts/uninstall.sh [OPTIONS]"
      echo "  --prefix <dir>   Install prefix (default: /usr/local)"
      echo "  --all            Also remove ~/.fam data directory"
      exit 0
      ;;
    *) echo -e "${RED}Unknown option: $1${RESET}"; exit 1 ;;
  esac
done

PREFIX="${PREFIX/#\~/$HOME}"
BIN_DIR="$PREFIX/bin"
LIB_DIR="$PREFIX/lib/fam"
FAM_HOME="$HOME/.fam"

info()  { echo -e "${GREEN}[+]${RESET} $1"; }
warn()  { echo -e "${YELLOW}[!]${RESET} $1"; }

# Remove symlink
if [[ -L "$BIN_DIR/fam" || -f "$BIN_DIR/fam" ]]; then
  rm -f "$BIN_DIR/fam"
  info "Removed $BIN_DIR/fam"
else
  warn "$BIN_DIR/fam not found"
fi

# Remove library
if [[ -d "$LIB_DIR" ]]; then
  rm -rf "$LIB_DIR"
  info "Removed $LIB_DIR"
else
  warn "$LIB_DIR not found"
fi

# Remove launchd plist if present
PLIST="$HOME/Library/LaunchAgents/com.sweetpapatech.fam.plist"
if [[ -f "$PLIST" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  info "Removed launchd plist"
fi

# Remove systemd unit if present
UNIT="$HOME/.config/systemd/user/fam.service"
if [[ -f "$UNIT" ]]; then
  systemctl --user disable fam 2>/dev/null || true
  systemctl --user stop fam 2>/dev/null || true
  rm -f "$UNIT"
  info "Removed systemd unit"
fi

# Remove data directory
if $REMOVE_DATA; then
  if [[ -d "$FAM_HOME" ]]; then
    rm -rf "$FAM_HOME"
    info "Removed $FAM_HOME"
  fi
else
  if [[ -d "$FAM_HOME" ]]; then
    warn "Data directory $FAM_HOME preserved. Use --all to remove it."
  fi
fi

info "FAM uninstalled."
