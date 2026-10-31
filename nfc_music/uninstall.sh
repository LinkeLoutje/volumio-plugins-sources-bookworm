#!/bin/sh
# NFC Music - undo exactly what install.sh did (state in install-state).
# Volumio runs this script as root with /bin/sh, so it must stay POSIX sh.

# Owned by root, outside the plugin's (volumio-writable) folders.
STATE_DIR="/var/lib/nfc_music"
STATE_FILE="$STATE_DIR/install-state"
ALLOWED_PACKAGES="pcscd libccid libpcsclite1"
BLACKLIST_FILE="/etc/modprobe.d/nfc_music-blacklist.conf"

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

INSTALLED_BY_PLUGIN=""
SOCKET_WAS_ENABLED=""
BLACKLIST_CREATED=""
# Read the install state WITHOUT executing it (the file is never sourced):
# only known keys, only yes/no values, and only packages from ALLOWED_PACKAGES,
# so a tampered file can never make this root script run or remove anything else.
read_state() {
    [ -f "$STATE_FILE" ] || return 0
    set -f   # no filename globbing while splitting package names
    while IFS='=' read -r key value; do
        value=${value#\"}
        value=${value%\"}
        case "$key" in
            INSTALLED_BY_PLUGIN)
                INSTALLED_BY_PLUGIN=""
                for pkg in $value; do
                    case " $ALLOWED_PACKAGES " in
                        *" $pkg "*) INSTALLED_BY_PLUGIN="$INSTALLED_BY_PLUGIN $pkg" ;;
                    esac
                done
                ;;
            SOCKET_WAS_ENABLED)
                case "$value" in yes|no) SOCKET_WAS_ENABLED="$value" ;; esac
                ;;
            BLACKLIST_CREATED)
                case "$value" in yes) BLACKLIST_CREATED="yes" ;; esac
                ;;
        esac
    done < "$STATE_FILE"
    set +f
}
read_state

if [ "$BLACKLIST_CREATED" = "yes" ] && [ -f "$BLACKLIST_FILE" ]; then
    echo "Removing kernel driver blacklist"
    $SUDO rm -f "$BLACKLIST_FILE"
fi

if [ "$SOCKET_WAS_ENABLED" = "no" ]; then
    echo "Restoring pcscd.socket to disabled"
    $SUDO systemctl disable --now pcscd.socket >/dev/null 2>&1 || true
fi

if [ -n "$INSTALLED_BY_PLUGIN" ]; then
    echo "Removing packages installed by NFC Music: $INSTALLED_BY_PLUGIN"
    $SUDO apt-get -y purge --auto-remove $INSTALLED_BY_PLUGIN
fi

# Only remove our own state. Volumio itself deletes
# /data/configuration/system_hardware/nfc_music (including tags.json) after this script.
$SUDO rm -f "$STATE_FILE"
$SUDO rmdir "$STATE_DIR" 2>/dev/null || true

echo "Done"
echo "pluginuninstallend"
