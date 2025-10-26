#!/bin/bash
# Metro Bundler Startup Script for Vertex Android App

echo "🚀 Starting Metro bundler..."
echo "📱 Make sure your device/emulator is connected"
echo ""

# Navigate to project directory
cd "$(dirname "$0")"

# Start Metro bundler
npm start

# Note: To reset cache, use: npm start -- --reset-cache
