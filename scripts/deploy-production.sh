#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
NGINX_CONF="$PROJECT_DIR/nginx/hmi.conf"

echo "=== HMI Production Deploy ==="
echo ""

# 1. Build React app
echo "[1/4] Building React production bundle..."
cd "$PROJECT_DIR"
CI=false npx react-scripts build
echo "  ✅ Build complete → $PROJECT_DIR/build/"
echo ""

# 2. Check if nginx is installed
echo "[2/4] Checking nginx..."
if ! command -v nginx &> /dev/null; then
    echo "  ❌ nginx not found. Install it first:"
    echo "     macOS:  brew install nginx"
    echo "     Linux:  sudo apt install nginx"
    exit 1
fi
echo "  ✅ nginx found at $(which nginx)"
echo ""

# 3. Update the root path in nginx config to match this machine
echo "[3/4] Configuring nginx..."
BUILD_DIR="$PROJECT_DIR/build"

if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS: nginx config location
    NGINX_DIR="/usr/local/etc/nginx"
    if [ ! -d "$NGINX_DIR" ]; then
        NGINX_DIR="/opt/homebrew/etc/nginx"
    fi
    CONF_TARGET="$NGINX_DIR/servers/hmi.conf"
    mkdir -p "$NGINX_DIR/servers"
else
    # Linux
    CONF_TARGET="/etc/nginx/sites-enabled/hmi.conf"
fi

# Create a config with the correct build path
sed "s|root .*build;|root $BUILD_DIR;|" "$NGINX_CONF" | sudo tee "$CONF_TARGET" > /dev/null
echo "  ✅ nginx config written to $CONF_TARGET"
echo ""

# 4. Test and reload nginx
echo "[4/4] Starting nginx..."
sudo nginx -t
if pgrep -x nginx > /dev/null; then
    sudo nginx -s reload
    echo "  ✅ nginx reloaded"
else
    sudo nginx
    echo "  ✅ nginx started"
fi

echo ""
echo "=== Done! ==="
echo ""
echo "Make sure your Node.js backend is running:"
echo "  cd $PROJECT_DIR/server && node index.js"
echo ""
echo "Then access the HMI at: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo localhost)"
echo ""
