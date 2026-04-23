#!/bin/bash
set -e

echo "Building curate-draw..."
npm run tauri build -- --bundles app

echo ""
echo "Resetting Screen Recording permission (needed after each unsigned build)..."
tccutil reset ScreenCapture com.jan-hendrik.curate-draw

echo ""
echo "Done. Launch the app — it will prompt for Screen Recording permission once."
