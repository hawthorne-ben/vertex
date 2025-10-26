# Upload Troubleshooting Guide

## The Chip Stopped Responding

If you see this error:
```
A fatal error occurred: The chip stopped responding.
```

### Solution 1: Enter Boot Mode Manually

1. **Hold the BOOT button** on your Feather ESP32
2. **Press and release RESET button** (while still holding BOOT)
3. **Release BOOT button**
4. **Run upload immediately**:
   ```bash
   arduino-cli upload -p /dev/cu.usbserial-5A6C0415631 --fqbn esp32:esp32:featheresp32 .
   ```

### Solution 2: Try Different USB Settings

```bash
# Upload with verbose output
arduino-cli upload -v -p /dev/cu.usbserial-5A6C0415631 --fqbn esp32:esp32:featheresp32 .

# Or try with before/after options
arduino-cli upload -p /dev/cu.usbserial-5A6C0415631 \
  --fqbn esp32:esp32:featheresp32 \
  --upload-field "tools.esptool_py.before" "default_reset" \
  --upload-field "tools.esptool_py.after" "hard_reset" \
  .
```

### Solution 3: Erase Flash First

Sometimes a bad flash needs to be erased:

```bash
# Erase flash
esptool.py --chip esp32 --port /dev/cu.usbserial-5A6C0415631 erase_flash

# Then upload
arduino-cli upload -p /dev/cu.usbserial-5A6C0415631 --fqbn esp32:esp32:featheresp32 .
```

### Solution 4: Check Port Permissions

```bash
# Add your user to dialout group (Linux/macOS)
sudo dseditgroup -o edit -a $(whoami) -t user _developer

# Or check if port is accessible
ls -l /dev/cu.usbserial*
```

### Solution 5: Use Different USB Port

- Try a different USB port
- Try a different USB cable (some cables are charge-only)
- Try a powered USB hub

## General Upload Tips

### Feather ESP32 V2 Buttons
- **BOOT**: Small button near USB port
- **RESET**: Button on opposite side

### Upload Sequence
1. Connect USB cable
2. Hold BOOT button
3. Press and release RESET (while holding BOOT)
4. Release BOOT
5. Run upload command immediately
6. Should see "Connecting..." then "Uploading..."

### If Upload Succeeds But Device Doesn't Work

1. Check Serial Monitor for errors:
   ```bash
   arduino-cli monitor -p /dev/cu.usbserial-5A6C0415631 -c baudrate 115200
   ```

2. Look for WiFi connection issues
3. Check sensor detection
4. Verify power supply (USB or battery)

## Alternative: Use Arduino IDE

If command line upload continues to fail:

1. Open Arduino IDE
2. Select Tools → Board → Adafruit ESP32 Feather
3. Select Tools → Port → /dev/cu.usbserial-5A6C0415631
4. Click Upload (while holding BOOT button if needed)

## Still Having Issues?

Check the serial monitor for error messages that might give more clues:

```bash
arduino-cli monitor -p /dev/cu.usbserial-5A6C0415631
```

Common issues in serial output:
- WiFi connection failures (check credentials in config.h)
- Sensor not detected (check I2C cable)
- Out of memory errors (rare with current firmware)
