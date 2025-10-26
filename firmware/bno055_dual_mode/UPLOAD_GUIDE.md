# Direct Upload Guide

Skip Arduino IDE and compile/upload directly from command line!

## Quick Start

### 1. Install arduino-cli

```bash
curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh
```

Or on macOS with Homebrew:
```bash
brew install arduino-cli
```

### 2. Run the Upload Script

```bash
cd firmware/bno055_dual_mode
./upload.sh
```

That's it! The script will:
1. ✅ Check for arduino-cli
2. ✅ Install ESP32 core (if needed)
3. ✅ Install required libraries (if needed)
4. ✅ Compile the firmware
5. ✅ Upload to ESP32
6. ✅ Open serial monitor

## Custom Port

If your ESP32 is on a different port:

```bash
./upload.sh /dev/tty.usbmodem14201  # macOS
./upload.sh /dev/ttyUSB1            # Linux
./upload.sh COM3                    # Windows (use arduino-cli monitor separately)
```

## Manual Steps (Alternative)

If you prefer to run commands manually:

```bash
# Compile
arduino-cli compile --fqbn esp32:esp32:featheresp32 .

# Upload
arduino-cli upload -p /dev/ttyUSB0 --fqbn esp32:esp32:featheresp32 .

# Monitor
arduino-cli monitor -p /dev/ttyUSB0
```

## Checking Port

To find your ESP32 port:

```bash
arduino-cli board list
```

Or on macOS:
```bash
ls /dev/tty.*
```

Look for devices like:
- `/dev/tty.usbmodem*` (macOS)
- `/dev/ttyUSB*` (Linux)
- `COM*` (Windows)

## Serial Monitor Options

The script will try to use these in order:
1. `screen` (best, native)
2. `picocom` (good alternative)
3. `arduino-cli monitor` (fallback)

Exit serial monitor: `Ctrl+A` then `K` (screen) or `Ctrl+C` (others)

## Troubleshooting

### arduino-cli not found
```bash
# Add to PATH (Linux/macOS)
export PATH=$PATH:$HOME/bin
# Add to ~/.zshrc or ~/.bashrc to make permanent
```

### Permission denied on port
```bash
# Linux: Add user to dialout group
sudo usermod -a -G dialout $USER
# Log out and back in
```

### Upload failed
- Press BOOT button on ESP32 during upload
- Try different USB port/cable
- Check port is correct: `arduino-cli board list`

### Compilation errors
- Make sure you're in the `bno055_dual_mode` directory
- Ensure all required libraries are installed
- Try: `arduino-cli lib list` to see installed libraries

## Advantages Over Arduino IDE

✅ **Faster**: No GUI overhead  
✅ **Scriptable**: Automate builds  
✅ **Easier logs**: See full compiler output  
✅ **Version control friendly**: Just edit files and upload  
✅ **Batch operations**: Upload to multiple boards  

## Continuous Development Workflow

```bash
# Edit code in your editor
vim bno055_dual_mode.ino

# Compile, upload, and monitor in one command
./upload.sh

# Works great with hot-reload editors!
```

## IDE Integration

Many editors/IDEs can use arduino-cli:
- **VS Code**: Arduino extension (uses arduino-cli)
- **CLion**: CMake with PlatformIO
- **Vim/Neovim**: Write and `:!./upload.sh` to upload

## Next Steps

Once uploaded, watch the serial output to see:
- WiFi connection status
- Calibration status
- Web server IP address
- Logging mode status

Happy coding! 🚀
