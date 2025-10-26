#!/bin/bash
# Generate Android app icons from SVG
# Requires: ImageMagick (brew install imagemagick)

set -e

echo "🎨 Generating Android app icons..."

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "❌ ImageMagick not found. Please install it:"
    echo "   brew install imagemagick"
    exit 1
fi

# Source SVG
SVG="app-icon-circular.svg"
if [ ! -f "$SVG" ]; then
    echo "❌ $SVG not found"
    exit 1
fi

# Output directories
BASE_DIR="android/app/src/main/res"

# Create directories if they don't exist
mkdir -p "$BASE_DIR/mipmap-mdpi"
mkdir -p "$BASE_DIR/mipmap-hdpi"
mkdir -p "$BASE_DIR/mipmap-xhdpi"
mkdir -p "$BASE_DIR/mipmap-xxhdpi"
mkdir -p "$BASE_DIR/mipmap-xxxhdpi"

# Generate icons in different sizes
echo "📱 Generating mipmap-mdpi (48x48)..."
convert -background none -density 300 "$SVG" -resize 48x48 "$BASE_DIR/mipmap-mdpi/ic_launcher.png"

echo "📱 Generating mipmap-hdpi (72x72)..."
convert -background none -density 300 "$SVG" -resize 72x72 "$BASE_DIR/mipmap-hdpi/ic_launcher.png"

echo "📱 Generating mipmap-xhdpi (96x96)..."
convert -background none -density 300 "$SVG" -resize 96x96 "$BASE_DIR/mipmap-xhdpi/ic_launcher.png"

echo "📱 Generating mipmap-xxhdpi (144x144)..."
convert -background none -density 300 "$SVG" -resize 144x144 "$BASE_DIR/mipmap-xxhdpi/ic_launcher.png"

echo "📱 Generating mipmap-xxxhdpi (192x192)..."
convert -background none -density 300 "$SVG" -resize 192x192 "$BASE_DIR/mipmap-xxxhdpi/ic_launcher.png"

# Create round versions (same files, Android handles the masking)
echo "📱 Generating round icons..."
for dir in mipmap-mdpi mipmap-hdpi mipmap-xhdpi mipmap-xxhdpi mipmap-xxxhdpi; do
    cp "$BASE_DIR/$dir/ic_launcher.png" "$BASE_DIR/$dir/ic_launcher_round.png"
done

echo ""
echo "✅ Icons generated successfully!"
echo ""
echo "Files created:"
find "$BASE_DIR" -name "ic_launcher*.png" -type f
echo ""
echo "🔄 Rebuild your app to see the new icon:"
echo "   cd android && ./gradlew clean && cd .. && npm run android"
