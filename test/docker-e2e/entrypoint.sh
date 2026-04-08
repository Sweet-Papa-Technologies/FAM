#!/bin/bash
set -e

# Start a D-Bus session bus (required by gnome-keyring)
eval $(dbus-launch --sh-syntax)
export DBUS_SESSION_BUS_ADDRESS

# Unlock the gnome-keyring with a fixed test password so @napi-rs/keyring works
echo -n "test-password" | gnome-keyring-daemon --unlock --components=secrets
export GNOME_KEYRING_CONTROL

exec "$@"
