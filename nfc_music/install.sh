#!/bin/sh
# NFC Music - install dependencies for ACR122U (and other PC/SC) NFC readers.
# Volumio runs this script as root with /bin/sh, so it must stay POSIX sh.

# Owned by root, outside the plugin's (volumio-writable) folders.
STATE_DIR="/var/lib/nfc_music"
STATE_FILE="$STATE_DIR/install-state"
ALLOWED_PACKAGES="pcscd libccid libpcsclite1"
BLACKLIST_FILE="/etc/modprobe.d/nfc_music-blacklist.conf"

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

# What earlier installs of this plugin recorded (kept on update, so uninstall
# still knows what this plugin originally added).
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

echo "Installing NFC Music dependencies"

# Remember the original state of pcscd.socket only the first time.
if [ -z "$SOCKET_WAS_ENABLED" ]; then
    if systemctl is-enabled --quiet pcscd.socket 2>/dev/null; then
        SOCKET_WAS_ENABLED="yes"
    else
        SOCKET_WAS_ENABLED="no"
    fi
fi

MISSING=""
for pkg in $ALLOWED_PACKAGES; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
        MISSING="$MISSING $pkg"
    fi
done

if [ -n "$MISSING" ]; then
    echo "Installing:$MISSING"
    if ! { $SUDO apt-get update && $SUDO apt-get -y install --no-install-recommends $MISSING; }; then
        echo "Installing packages failed"
        # Volumio detects failure by the exit code; this line only ends its log view.
        echo "plugininstallend"
        exit 1
    fi
    INSTALLED_BY_PLUGIN="$INSTALLED_BY_PLUGIN$MISSING"
else
    echo "All required packages already installed"
fi

# The kernel NFC drivers claim the ACR122U before pcscd can use it.
# Only create our own file; never edit existing system files.
if [ ! -f "$BLACKLIST_FILE" ]; then
    echo "Blacklisting kernel NFC drivers (pn533_usb, pn533, nfc) for pcscd"
    printf '%s\n' \
        "# Added by the Volumio NFC Music plugin - removed on uninstall" \
        "blacklist pn533_usb" \
        "blacklist pn533" \
        "blacklist nfc" | $SUDO tee "$BLACKLIST_FILE" >/dev/null
    BLACKLIST_CREATED="yes"
    $SUDO modprobe -r pn533_usb pn533 nfc 2>/dev/null || true
fi

$SUDO systemctl enable --now pcscd.socket >/dev/null 2>&1 || true

# Save the install state, readable only as data (see read_state), owned by root.
$SUDO install -d -m 0755 -o root -g root "$STATE_DIR"
{
    echo "INSTALLED_BY_PLUGIN=\"$(echo $INSTALLED_BY_PLUGIN)\""
    echo "SOCKET_WAS_ENABLED=\"$SOCKET_WAS_ENABLED\""
    echo "BLACKLIST_CREATED=\"$BLACKLIST_CREATED\""
} | $SUDO tee "$STATE_FILE" >/dev/null
$SUDO chown root:root "$STATE_FILE"
$SUDO chmod 0644 "$STATE_FILE"

echo "NFC Music dependencies installed"
echo "If your reader is not detected, unplug and replug it (or reboot)."

#required to end the plugin install
echo "plugininstallend"
