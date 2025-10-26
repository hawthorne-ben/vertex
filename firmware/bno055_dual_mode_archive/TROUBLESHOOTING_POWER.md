# Power Issue Troubleshooting

## Current Setup
- MacBook Air USB power
- 3.7V LiPo battery connected
- BNO055 via STEMMA QT cable
- LED turns on then off

## Possible Issues

### 1. **STEMMA QT Cable Connection (Most Likely)**

The LED turning on then off suggests:
- Power briefly connected
- Then disconnects

**Check:**
1. **Unplug and replug** the STEMMA QT cable on both ends
   - Look for "click" when plugging in
   - Connector should sit flush
   
2. **Check cable for damage**
   - Look for kinks, crimps, or cuts
   - Try wiggling cable while powered
   - Does LED flicker?

3. **Try a different STEMMA QT cable** if available

### 2. **Battery Interference**

Having battery + USB connected can cause issues:
- Battery might be pulling too much current
- Bad battery cell causing voltage drop

**Test:**
1. **Disconnect battery** (keep USB only)
2. Upload and test
3. If works → battery issue

### 3. **Software Issue (Unlikely but Check)**

Since it worked before, might be:
- Code change broke something
- Sensor got into bad state

**Test with old firmware:**
1. Upload the working `bno055_webserver.ino`
2. Does sensor work?
3. If yes → new firmware issue
4. If no → hardware issue

### 4. **Heat Damage**

Did it get very hot while running?
- ESP32 can survive brief overheating
- BNO055 more sensitive to over-temperature

**Check:**
- Look for any discolored components
- Smell for burnt electronics smell
- Check if sensor board is hot when powered

## Immediate Tests

### Test 1: Check Power Delivery
1. Unplug battery
2. Keep USB connected
3. Upload firmware
4. Watch BNO055 LED - should stay ON

### Test 2: Check STEMMA QT Connection
1. Unplug cable from sensor
2. Look at sensor connector pins
3. Should see 4 gold pins (GND, 3V, SCL, SDA)
4. Are any bent or damaged?
5. Plug back in firmly

### Test 3: Try Old Firmware
1. Open `bno055_webserver.ino` in Arduino IDE
2. Upload (should work if hardware OK)
3. Check serial monitor for sensor detection

### Test 4: Visual Inspection
Look at both boards for:
- Burn marks
- Loose components
- Damaged traces
- Solder joints that look bad

## Most Likely Fix

**Steamma QT cable not fully seated**

Do this:
1. Pull cable out from both ends
2. Inspect connectors for damage
3. Plug into BNO055 FIRST - push until you feel click
4. Then plug into Feather - push until you feel click
5. Give a gentle tug - should NOT come loose
6. Upload firmware and test

## If Nothing Works

Hardware failure possible:
1. Try a different STEMMA QT cable
2. Try old firmware to rule out code issue
3. Disconnect battery to rule out power issue
4. Check if sensor works on another I2C controller

**Order of likelihood:**
1. STEMMA QT cable issue (90%)
2. Battery causing power issue (5%)
3. Sensor hardware failure (3%)
4. Software/code issue (2%)
