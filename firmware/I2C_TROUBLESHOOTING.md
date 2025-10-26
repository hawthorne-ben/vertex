# I2C Error Troubleshooting Guide

## Common I2C Errors

### Error: "I2C transaction unexpected nack detected"
**Cause**: Sensor not responding on I2C bus
**Symptoms**: 
- System crashes/hangs
- Data stops updating
- May reboot continuously

### Root Causes

1. **Loose STEMMA QT Cable** (Most Common)
   - Cable not fully seated
   - Intermittent connection during operation
   - **Fix**: Check both ends of cable, ensure fully plugged in

2. **Power Issues**
   - Insufficient power to sensor
   - Voltage drop under load
   - **Fix**: Ensure battery is charged or use USB power

3. **I2C Bus Problems**
   - Pull-up resistor issues
   - Too much capacitance on bus
   - EM interference
   - **Fix**: Check wiring, reduce cable length

4. **Sensor Module Failure**
   - BNO055 module malfunctioning
   - **Fix**: Try a different sensor module

## What the New Firmware Does

The updated firmware now includes:

### 1. Error Detection
- Checks if sensor data is valid (NaN detection)
- Monitors for I2C errors silently

### 2. Automatic Recovery
- After 5 consecutive errors, attempts to reinitialize sensor
- Resets I2C bus
- Reinitializes BNO055 module

### 3. Graceful Degradation
- Continues running even if sensor fails
- Serves stale data instead of crashing
- Logs warnings to Serial Monitor

### 4. WiFi Auto-Reconnect
- Detects WiFi disconnection
- Attempts to reconnect every 30 seconds
- Doesn't require manual intervention

## Testing the Fixes

### Test 1: Disconnect Sensor
1. Run the firmware
2. Pull out the STEMMA QT cable
3. **Expected**: Serial shows "[WARN] I2C error detected"
4. After 5 errors: "[ERROR] Too many I2C errors, attempting recovery..."
5. Reconnect cable
6. Should recover automatically

### Test 2: Sensor Recovery
1. Let sensor run for a while
2. Disconnect sensor during operation
3. Wait 5+ seconds
4. Reconnect sensor
5. Watch Serial Monitor for recovery message

### Test 3: WiFi Disconnect
1. Connect to WiFi
2. Disable your WiFi network
3. **Expected**: After 30 seconds, shows reconnect attempt
4. Re-enable WiFi
5. Should reconnect automatically

## Still Having Issues?

### Hardware Checklist
- [ ] STEMMA QT cable fully seated at both ends
- [ ] Battery fully charged OR using USB power
- [ ] No loose connections
- [ ] Cable not damaged or kinked
- [ ] Sensor module not defective

### Software Checklist
- [ ] Latest firmware uploaded
- [ ] Serial Monitor showing sensor initialization OK
- [ ] WiFi credentials correct
- [ ] Board selected correctly (Adafruit Feather ESP32 V2)

### Advanced Debugging

If issues persist, add more verbose logging:

```cpp
// In updateSensorData(), add after each sensor read:
Serial.print("Reading sensor...");
// Read sensors
Serial.println("OK");
```

Watch Serial Monitor for where it fails.

## Prevention

### Best Practices
1. **Secure connections** - Make sure cables are firmly seated
2. **Use quality components** - Reliable cables and boards
3. **Proper power** - Don't operate on low battery
4. **Stable mounting** - Secure sensor to prevent vibration-related disconnects

### For Production
Consider adding:
- **I2C bus health monitoring** - Periodic bus diagnostics
- **Circuit protection** - ESD protection on I2C lines
- **Data validation** - Range checks on all sensor values
- **Persistent logging** - SD card error logs for field debugging

## Error Codes Reference

| Error Message | Meaning | Action |
|---------------|---------|--------|
| `[WARN] I2C error detected` | Sensor not responding | Check connections |
| `[ERROR] Too many I2C errors` | Repeated failures | Auto-recovery initiated |
| `[OK] Sensor recovered!` | Successful recovery | Normal operation resumed |
| `[ERROR] Sensor recovery failed!` | Recovery unsuccessful | Check hardware |
| `[WARN] WiFi disconnected` | Network lost | Auto-reconnect will attempt |
| `I2C transaction unexpected nack` | ESP32 I2C error | Check sensor power/connections |
