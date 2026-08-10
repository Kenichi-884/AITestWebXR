#!/bin/bash

# macOS startup script
# Double-click this file in Finder to open in Terminal.app

cd "$(dirname "$0")"

clear
echo ""
echo "============================================"
echo "  MR Shooter WebXR - Dev Server"
echo "============================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js not found."
    echo ""
    echo "Please install Node.js from:"
    echo "  https://nodejs.org/"
    echo "  * Choose the LTS version"
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

echo "Node.js $(node -v) detected."

# Run npm install if node_modules is missing
if [ ! -d "node_modules" ]; then
    echo ""
    echo "[SETUP] First-time setup - please wait..."
    echo ""
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo "[ERROR] npm install failed."
        read -p "Press Enter to close..."
        exit 1
    fi
    echo ""
    echo "Setup complete!"
fi

# Start dev server
echo ""
echo "============================================"
echo "  Starting server..."
echo "============================================"
echo ""
echo "  Access the app at:"
echo ""
echo "    This Mac  : https://localhost:5173"
echo "    Meta Quest: https://[this Mac's IP]:5173"
echo "              (see 'Network' URL below)"
echo ""
echo "  If browser shows 'Connection not private',"
echo "  click 'Advanced' then 'Proceed'."
echo ""
echo "  Press Ctrl+C to stop the server."
echo "============================================"
echo ""

npm run dev

echo ""
echo "Server stopped."
read -p "Press Enter to close..."
