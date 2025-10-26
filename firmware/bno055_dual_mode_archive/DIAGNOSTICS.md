# BNO055 Diagnostics Guide

## Issue: Sensor LED Turns On Then Off

If you see the BNO055 LED turn on briefly during reset then turn off, this indicates a power delivery issue.

## Possible Causes

### 1. USB Port Not Providing Enough Power
- **Symptom**: LED turns on then off
- **Solution**: Use a powered USB hub or a different USB port
- **Test**: Try a wall charger with USB-C cable

### 2. BNO055 Not Getting Power Through STEMMA QT
- **Symptom**: LED doesn't stay on
- **Check**: 
  - STEMMA QT cable fully plugged in on both ends
  - Red LED should stay ON when sensor has power
  - Green LED indicates I2C communication
- **Test**: Try wiggling the cable to see if connection is intermittent

### 3. I2C Bus Issue (Less Likely)
- **Symptom**: LED stays on but device not detected
- **Check**: Your diagnostic output shows "No I2C devices found!"
- **Solution**: See Arduino IDE board selection below

## Arduino IDE Board Selection

**CRITICAL**: Make sure you're using the Adafruit board definition!

### Check Your Board Selection:
1. Tools → Board → **Adafruit ESP32 Feather**
   - NOT "ESP32 Dev Module"
   - NOT "Adafruit Feather HUZZAH32"
   - Should specifically say "Adafruit ESP32 Feather"

### If Adafruit Board Not Available:
1. File → Preferences → Additional Boards Manager URLs
2. Add: `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
3. Tools → Board → Boards Manager
4. Search for "ESP32" → Install "esp32 by Espressif Systems"
5. Restart Arduino IDE

## Quick Test

### Test 1: Check if sensor stays powered
1. Disconnect USB cable
2. Look at BNO055 board - LED should be OFF
3. Plug in USB cable
4. LED should turn ON and stay ON
5. If LED turns off after a few seconds → power issue

### Test 2: Check cable connection
1. Unplug STEMMA QT cable from both ends
2. Look at connectors - should be clean, gold pins visible
3. Plug back in firmly - should click/seat
4. Try wiggling - LED should not flicker

### Test 3: Try different USB setup
1. Try different USB port on computer
2. Try USB port directly on computer (not hub)
3. Try different USB cable
4. Try using a powered USB hub

## Diagnostic Output

When you upload the firmware with diagnostics, you should see:

```
[I2C] Initializing I2C bus...
[I2C] Scanning for I2C devices...
[I2C] Device found at address 0x28  ← BNO055 address
[I2C] Found 1 device(s)
[I2C] Initializing BNO055...
[OK] BNO055 initialized!
```

If you see:
```
[I2C] No I2C devices found!
```

This means either:
1. Sensor not getting power (LED off)
2. I2C bus not working (wrong board selected)
3. Cable not connected properly

## Most Likely Solution

Based on LED turning on then off:

**The sensor is not getting enough power through the STEMMA QT cable.**

Try:
1. Use a **powered USB hub** between your computer and Feather
2. Or use a **wall charger** to power the Feather ESP32
3. The USB port might be limiting power to 100mA
4. Feather ESP32 + BNO055 needs ~200-300mA

## Alternative Test

If you have a multimeter:
1. Measure voltage on STEMMA QT 3.3V pin
2. Should read 3.3V
3. If reads 0V or low voltage → power delivery issue
