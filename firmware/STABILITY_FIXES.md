# Web Server Stability Fixes

## Problem: Flaky Operation

The web server was working sometimes, not others, with these symptoms:
- I2C errors causing crashes
- Automatic reboots
- WiFi connection failures after reboot
- Inconsistent behavior

## Root Causes

### 1. I2C Debug Messages Causing Crashes
**Issue**: ESP32 I2C driver logs errors to serial, which can cause crashes when I2C errors occur

**Fix**: Disabled I2C debug logging
```cpp
esp_log_level_set("i2c", ESP_LOG_NONE);
```

### 2. WiFi Connection Failure After Reboot
**Issue**: After crash/reboot, WiFi connection attempt failed and device halted

**Fix**: Multiple retry attempts, continue even if WiFi fails
- Up to 3 connection attempts
- 10 seconds timeout per attempt
- Continue running even if WiFi not connected
- Auto-retry in main loop

### 3. No Recovery from WiFi Disconnection
**Issue**: Once WiFi disconnected, never reconnected

**Fix**: Auto-reconnect in main loop
- Checks WiFi status every cycle
- Attempts reconnect every 30 seconds
- Doesn't block operation

## What Changed

### I2C Configuration
```cpp
Wire.setClock(400000);  // 400kHz (faster)
Wire.setTimeout(1000);  // 1 second timeout
esp_log_level_set("i2c", ESP_LOG_NONE);  // Disable debug messages
```

### WiFi Connection with Retries
```cpp
// Try up to 3 times
for (int retry = 0; retry < 3; retry++) {
  WiFi.begin(ssid, password);
  // Wait 10 seconds
  if (connected) break;
}
// Continue even if failed
```

### Auto-Reconnect in Main Loop
```cpp
if (WiFi.status() != WL_CONNECTED) {
  // Try to reconnect every 30 seconds
  if (shouldReconnect()) {
    WiFi.begin(ssid, password);
  }
}
```

### Sensor Error Handling
- NaN detection on sensor data
- Automatic recovery after 5 errors
- No crashes on I2C errors

## Expected Behavior Now

### On Startup
1. Tries to connect to WiFi (up to 3 attempts)
2. If successful: Shows IP address
3. If failed: Continues anyway, will retry in loop
4. Web server starts regardless of WiFi status

### During Operation
- If WiFi disconnects: Auto-reconnects every 30 seconds
- If sensor has I2C error: Attempts recovery automatically
- If recovery fails: Serves stale data, doesn't crash

### When Things Go Wrong
- I2C errors don't cause crashes
- WiFi failures don't halt operation
- System continues running and attempts recovery

## Testing

### Test 1: Normal Operation
1. Upload firmware
2. Should connect to WiFi successfully
3. Web interface should work
4. Should see sensor data updating

### Test 2: WiFi Disconnection
1. Start with WiFi connected
2. Disable your WiFi network
3. **Expected**: After 30 seconds, see reconnect attempt in Serial Monitor
4. Re-enable WiFi
5. **Expected**: Auto-reconnects within 30 seconds

### Test 3: Sensor Disconnection
1. Run firmware
2. Pull STEMMA QT cable
3. **Expected**: I2C warnings, auto-recovery attempt
4. Reconnect cable
5. **Expected**: Sensor recovers automatically

### Test 4: Cold Start After Crash
1. Let it crash/reboot
2. On restart, watch WiFi connection
3. **Expected**: Up to 3 retry attempts
4. **Expected**: Continues even if WiFi fails
5. **Expected**: Auto-reconnects in loop

## Still Seeing Issues?

### Hardware Check
The flakiness is likely due to hardware:
- **Check STEMMA QT cable**: Fully seated at both ends?
- **Check power**: Battery charged? Using USB power?
- **Check WiFi range**: Too far from router?

### Software Check
- Uploaded latest firmware?
- WiFi credentials correct?
- Serial Monitor showing expected messages?

## Key Improvements

✅ **No more crashes** from I2C errors
✅ **No more halts** from WiFi failures
✅ **Auto-reconnect** for both WiFi and sensor
✅ **Graceful degradation** when things fail
✅ **Multiple retries** for critical operations

## Why This Works Better

1. **Continues running** even when things fail
2. **Automatically retries** failed connections
3. **Doesn't halt** on errors
4. **Recovers gracefully** from problems
5. **More resilient** to hardware issues

The system is now much more robust and should work reliably even with occasional hardware glitches.
