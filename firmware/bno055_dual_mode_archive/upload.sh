#!/bin/bash

# ESP32 Direct Upload Script
# Compiles and uploads firmware without Arduino IDE
# Also monitors serial output after upload

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
# Using Adafruit Feather ESP32 V2 board definition
BOARD="esp32:esp32:adafruit_feather_esp32_v2"
PORT="${1:-/dev/tty.usbmodem*}"  # First argument or default USB port
BAUD="115200"
UPLOAD_BAUD="115200"  # Upload baud rate (try slower if upload fails)

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKETCH_DIR="$SCRIPT_DIR"
SKETCH_NAME="bno055_dual_mode"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  ESP32 Direct Upload Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if arduino-cli is installed
if ! command -v arduino-cli &> /dev/null; then
    echo -e "${RED}❌ arduino-cli not found!${NC}"
    echo ""
    echo "Please install arduino-cli:"
    echo "  curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓ arduino-cli found${NC}"

# Initialize arduino-cli if needed
if [ ! -f "$HOME/.arduino15/arduino-cli.yaml" ]; then
    echo -e "${YELLOW}Initializing arduino-cli...${NC}"
    arduino-cli config init || true
else
    echo -e "${GREEN}✓ Arduino CLI config found${NC}"
fi

# Update core index
echo -e "${YELLOW}Updating core index...${NC}"
arduino-cli core update-index

# Install ESP32 core if not installed
echo -e "${YELLOW}Installing ESP32 core...${NC}"
arduino-cli core install esp32:esp32

# Install required libraries
echo -e "${YELLOW}Installing required libraries...${NC}"
arduino-cli lib install "Adafruit BNO055"
arduino-cli lib install "Adafruit Unified Sensor"
arduino-cli lib install "Adafruit NeoPixel"

echo ""

# Set board
echo -e "${BLUE}Setting board: ${BOARD}${NC}"
arduino-cli config set board_manager.additional_urls https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json

# Compile
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Compiling...${NC}"
echo -e "${BLUE}========================================${NC}"
arduino-cli compile --fqbn $BOARD "$SKETCH_DIR"

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Compilation failed!${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✓ Compilation successful${NC}"

# Check port
if [ ! -e "$PORT" ]; then
    echo ""
    echo -e "${RED}❌ Port $PORT not found!${NC}"
    echo ""
    echo "Available ports:"
    arduino-cli board list
    exit 1
fi

echo -e "${GREEN}✓ Port found: $PORT${NC}"

# Upload
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Uploading to $PORT...${NC}"
echo -e "${BLUE}========================================${NC}"

# Try to upload with specified baud rate
arduino-cli upload -p $PORT --fqbn $BOARD \
  --upload-field "upload_speed" "$UPLOAD_BAUD" \
  --upload-field "boot" "nodownload" \
  "$SKETCH_DIR"

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Upload failed!${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✓ Upload successful${NC}"

# Monitor serial output
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Opening Serial Monitor...${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Press Ctrl+C to stop monitoring"
echo ""

# Use screen or arduino-cli monitor
if command -v screen &> /dev/null; then
    screen $PORT $BAUD
elif command -v picocom &> /dev/null; then
    picocom -b $BAUD $PORT
else
    arduino-cli monitor -p $PORT
fi
