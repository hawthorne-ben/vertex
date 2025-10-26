#!/bin/bash

# Simple upload script for Feather ESP32 V2 with 115200 baud rate

# Find ESP32 port
PORT=$(ls /dev/cu.usbmodem* /dev/tty.usbmodem* 2>/dev/null | head -1)

if [ -z "$PORT" ]; then
    echo "❌ No ESP32 found! Please connect your Feather ESP32."
    exit 1
fi

echo "📡 Found ESP32 on: $PORT"
echo ""

# Upload with Arduino IDE settings
arduino-cli upload \
  -p $PORT \
  --fqbn esp32:esp32:featheresp32 \
  --upload-field "upload_speed" "115200" \
  --upload-field "board_build.partitions" "min_spiffs.csv" \
  .

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Upload successful!"
    echo ""
    echo "Opening serial monitor in 2 seconds..."
    sleep 2
    arduino-cli monitor -p $PORT -c baudrate 115200
else
    echo ""
    echo "❌ Upload failed. Try manually entering boot mode:"
    echo "   1. Hold BOOT button"
    echo "   2. Press RESET (while holding BOOT)"
    echo "   3. Release BOOT"
    echo "   4. Run this script again"
fi
