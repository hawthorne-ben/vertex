#!/bin/bash
# Production APK Build Script for Vertex Android App

set -e

echo "🏗️  Building Vertex Android App for Production"
echo ""

# Navigate to Android app directory
cd "$(dirname "$0")"

# Check if .env.production exists
if [ ! -f ".env.production" ]; then
    echo "❌ Error: .env.production not found"
    echo "Please create .env.production with your production Supabase credentials"
    exit 1
fi

# Set environment to use .env.production via ENVFILE
echo "📝 Using production environment variables..."
export ENVFILE=.env.production

# Set production environment for Babel (strips console.log)
export NODE_ENV=production
export BABEL_ENV=production

# Clean previous builds
echo "🧹 Cleaning previous builds..."
cd android
./gradlew clean

# Build release APK
echo "🔨 Building release APK..."
echo "   (console.log statements will be stripped from production build)"
./gradlew assembleRelease

# Check if build was successful
if [ -f "app/build/outputs/apk/release/app-release.apk" ]; then
    echo ""
    echo "✅ Build successful!"
    echo ""
    echo "📦 APK Location:"
    echo "   $(pwd)/app/build/outputs/apk/release/app-release.apk"
    echo ""
    echo "📱 To install on device:"
    echo "   adb install app/build/outputs/apk/release/app-release.apk"
    echo ""
    echo "⚠️  Note: This APK is signed with the debug keystore."
    echo "   For production release, generate a production keystore first."
else
    echo ""
    echo "❌ Build failed!"
    exit 1
fi
