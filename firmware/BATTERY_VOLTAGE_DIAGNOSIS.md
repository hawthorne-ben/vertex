# Battery Voltage Diagnosis Report

**Date:** 2025-10-31
**Issue:** Battery not charging above 3.79V on prototype, new 1200mAh battery showing 3.64V after 10 minutes

## Battery Voltage Reading Code Analysis

### Current Implementation (sensor_notify.ino:552-553)

```cpp
int adcValue = analogRead(BATTERY_PIN);
sensorData.battery_voltage = (adcValue / 4095.0) * 3.3 * BATTERY_VOLTAGE_DIVIDER;
```

Where:
- `BATTERY_PIN = 35` (GPIO 35 / A13)
- `BATTERY_VOLTAGE_DIVIDER = 2.0`

### Adafruit's Recommended Implementation

```cpp
#define VBATPIN A13

float measuredvbat = analogReadMilliVolts(VBATPIN);
measuredvbat *= 2;    // we divided by 2, so multiply back
measuredvbat /= 1000; // convert to volts!
```

## Critical Issues Found

### 1. ❌ MISSING ADC CONFIGURATION

**Problem:** Your code does NOT set ADC attenuation or resolution

**Current code:**
```cpp
int adcValue = analogRead(BATTERY_PIN);  // Uses default ADC settings
```

**Should be:**
```cpp
analogSetAttenuation(ADC_11db);  // Set 11dB attenuation (0-3.3V range)
analogReadResolution(12);         // Explicitly set 12-bit resolution
int adcValue = analogRead(BATTERY_PIN);
```

**Impact:** Without explicit attenuation settings, the ADC may be using a narrower voltage range (default could be 0-800mV, 0-1100mV, or 0-1350mV), causing voltage readings to max out prematurely.

### 2. ⚠️ INCONSISTENT REFERENCE VOLTAGE

**Your calculation:**
```cpp
voltage = (adcValue / 4095.0) * 3.3 * 2.0
```

**Issue:** Uses 3.3V as ADC reference voltage, which is correct for ESP32

**However:** ESP32 ADC has non-linear characteristics and the actual reference voltage may not be exactly 3.3V without calibration. The ADC can have significant error (±5% or more) without eFuse calibration data.

### 3. ✅ VOLTAGE DIVIDER IS CORRECT

Your `BATTERY_VOLTAGE_DIVIDER = 2.0` matches Adafruit's specification (200K+200K divider creates 1:2 ratio).

### 4. ❌ NO ADC CALIBRATION

**Problem:** ESP32 ADC is notoriously inaccurate without calibration

Adafruit's documentation shows using `analogReadMilliVolts()` which internally uses ADC calibration from eFuse if available. Your raw `analogRead()` approach bypasses this calibration.

## LiPo Battery Charging Specifications

### Normal LiPo Voltage Ranges (per Adafruit documentation)

- **Fully Charged:** 4.2V
- **Nominal:** 3.7V (most of battery life)
- **Cutoff:** 3.2V (protection circuit disconnects)

### Your Reported Voltages

1. **Prototype battery:** 3.79V max (after charging)
2. **New 1200mAh battery:** 3.64V (after 10 min charge)

## Diagnosis: Multiple Contributing Factors

### Issue 1: ADC Configuration Bug (HIGH LIKELIHOOD)

**Verdict:** 🔴 **BUG IN CODE - This is likely the primary issue**

Without `analogSetAttenuation(ADC_11db)`, your ESP32 ADC is probably using a restricted voltage range. This means:

- If default is 0-800mV attenuation, max reading = 800mV * 2 = 1.6V ❌
- If default is 0-1100mV attenuation, max reading = 1100mV * 2 = 2.2V ❌
- If default is 0-1350mV attenuation, max reading = 1350mV * 2 = 2.7V ❌
- With ADC_11db (0-2600mV), max reading = 2600mV * 2 = 5.2V ✅

**The voltage divider brings 4.2V battery down to 2.1V**, which is ABOVE the default ADC ranges but within the ADC_11db range.

This explains why you're seeing ~3.79V instead of 4.2V - the ADC is maxing out at a lower voltage input.

### Issue 2: Inaccurate ADC (MEDIUM LIKELIHOOD)

**Verdict:** 🟡 **CONTRIBUTING FACTOR**

Even with correct attenuation, ESP32 ADC without calibration can have ±5-10% error. This could account for 0.2-0.4V discrepancy.

### Issue 3: Battery/Charger Hardware (LOW-MEDIUM LIKELIHOOD)

**Verdict:** 🟢 **UNLIKELY TO BE PRIMARY ISSUE, but possible**

#### Scenario A: Battery is fine, code is wrong
- New batteries ship at ~3.6-3.8V (storage charge)
- 10 minutes charging could bring it to 3.9-4.0V
- If your code reads 3.64V but actual voltage is 4.0V → this is the ADC bug

#### Scenario B: Charger is working slowly
- 1200mAh battery charging at standard 0.5C = 600mA charge rate
- After 10 min = 100mAh added
- Could be normal slow charging (depends on charge IC settings)

#### Scenario C: Faulty charger circuit
- ESP32 Feather V2 uses MCP73831 or similar LiPo charger IC
- These are designed to charge to 4.2V ±50mV
- If charger IC is faulty/misconfigured, could stop at lower voltage
- **However, this is unlikely** - Adafruit boards are well-tested

#### Scenario D: Battery is defective
- Battery protection circuit cutting off early (rare)
- Battery cell defect (very rare from Adafruit)
- **However, you report TWO batteries with similar behavior** → makes battery defect unlikely

### Issue 4: Prototype Battery History (MEDIUM LIKELIHOOD)

**Verdict:** 🟡 **POSSIBLE FOR OLD BATTERY**

The prototype battery showing 3.79V max could be:
- Battery degradation from use/age (capacity loss, higher internal resistance)
- Over-discharged in the past (permanent damage)
- But again, **if code has ADC bug, you're not seeing true voltage**

## Recommended Fixes (In Priority Order)

### Fix 1: Add ADC Configuration (DO THIS FIRST) ⭐⭐⭐

**Add to setup() immediately after Serial.begin():**

```cpp
void setup() {
  Serial.begin(115200);
  delay(1000);

  // Configure ADC for battery voltage reading
  analogSetAttenuation(ADC_11db);  // Set 11dB attenuation for 0-3.3V range
  analogReadResolution(12);         // Set 12-bit resolution (0-4095)

  // Rest of setup...
}
```

**Expected result:** Voltage readings should now go up to 4.2V when fully charged

### Fix 2: Use Adafruit's Recommended Method ⭐⭐

**Replace battery reading code with:**

```cpp
// In sensor_notify.ino, replace lines 552-553:
float measuredvbat = analogReadMilliVolts(BATTERY_PIN);  // Returns mV with calibration
sensorData.battery_voltage = (measuredvbat * 2.0) / 1000.0;  // Convert to volts
```

**Benefits:**
- Uses internal ADC calibration from eFuse
- More accurate than raw analogRead() approach
- Recommended by Adafruit

### Fix 3: Add Voltage Range Validation ⭐

**Add sanity checking:**

```cpp
if (now - lastBatteryReadTime >= BATTERY_READ_INTERVAL_MS) {
  analogSetAttenuation(ADC_11db);  // Ensure correct attenuation
  float measuredvbat = analogReadMilliVolts(BATTERY_PIN);
  sensorData.battery_voltage = (measuredvbat * 2.0) / 1000.0;

  // Sanity check - LiPo should be 3.0V - 4.3V
  if (sensorData.battery_voltage < 2.5 || sensorData.battery_voltage > 4.5) {
    Serial.printf("[WARNING] Battery voltage out of range: %.2fV\n", sensorData.battery_voltage);
  }

  lastBatteryReadTime = now;
}
```

### Fix 4: Add Battery Charging Detection (Optional) ⭐

**Detect if USB is connected and charging:**

```cpp
// In setup():
pinMode(VUSB_SENSE_PIN, INPUT);  // Check if USB power is present (varies by board)

// In battery reading:
bool isCharging = digitalRead(VUSB_SENSE_PIN) == HIGH;
Serial.printf("[BATTERY] %.2fV %s\n",
  sensorData.battery_voltage,
  isCharging ? "(charging)" : "");
```

## Testing Plan

### Test 1: Verify ADC Bug Fix

1. **Flash updated firmware** with `analogSetAttenuation(ADC_11db)` added
2. **Plug in USB** and let battery charge for 30+ minutes
3. **Monitor serial output** for voltage readings
4. **Expected result:** Voltage should climb toward 4.2V

**If voltage now reaches 4.0-4.2V:** ✅ ADC bug was the issue
**If voltage still maxes at 3.8V:** ⚠️ Hardware issue possible

### Test 2: Measure with Multimeter

1. **Remove ESP32 from power**
2. **Use multimeter** to measure battery voltage directly at battery terminals
3. **Compare** to what firmware reports

**If multimeter shows 4.2V but firmware shows 3.8V:** ADC calibration issue
**If multimeter shows 3.8V too:** Hardware problem (charger or battery)

### Test 3: Test New Battery

1. **Install fresh 1200mAh battery**
2. **Plug in USB** and charge for 2-3 hours (full charge)
3. **Check voltage** - should reach 4.1-4.2V

**If reaches 4.2V:** ✅ Old battery was degraded, charger works
**If maxes at 3.8V:** ⚠️ Charger IC issue

### Test 4: Verify Charger LED

Most ESP32 Feather boards have a charging indicator LED:
- **Red/Orange while charging**
- **Green when complete** (or LED off)

**If LED turns green at 3.8V:** Charger thinks battery is full (IC misconfiguration)
**If LED stays red:** Charger is still trying to charge (normal)

## Expected Behavior After Fix

### During Charging
- **Start:** 3.6-3.7V (storage charge)
- **After 30 min:** 3.8-3.9V
- **After 1 hour:** 4.0-4.1V
- **After 2-3 hours:** 4.15-4.2V (fully charged)
- **Charge complete:** LED changes, voltage holds at 4.2V

### During Discharge
- **Fresh off charger:** 4.2V
- **After 5 min use:** 3.9-4.0V (initial voltage drop)
- **Most of use time:** 3.7-3.8V (nominal)
- **Low battery warning:** < 3.4V
- **Cutoff:** 3.2V (protection circuit)

## Conclusion

### Primary Diagnosis: 🔴 CODE BUG (ADC Configuration)

**Confidence:** 85%

Your firmware is missing critical ADC configuration:
- No `analogSetAttenuation(ADC_11db)` call
- ADC is likely using restricted voltage range
- Battery voltage gets clamped below 4.2V at the ADC input stage

### Secondary Factor: 🟡 ADC Calibration

**Confidence:** 60%

Using raw `analogRead()` instead of `analogReadMilliVolts()`:
- Bypasses eFuse calibration data
- Can introduce ±5-10% error
- Contributes to inaccurate readings

### Hardware Issue: 🟢 UNLIKELY

**Confidence:** 20%

Hardware problem is possible but unlikely because:
- Two different batteries show similar behavior
- Adafruit boards are well-tested and reliable
- More likely that code is measuring incorrectly than charger failing

## Recommended Action Plan

1. **Immediate:** Add `analogSetAttenuation(ADC_11db)` to setup() (5 minutes)
2. **Short-term:** Replace with `analogReadMilliVolts()` method (10 minutes)
3. **Testing:** Charge battery and monitor voltage (30-60 minutes)
4. **Validation:** Use multimeter to verify readings (5 minutes)
5. **If still wrong:** Hardware investigation with multimeter on charger IC pins

## Code Changes Summary

### Minimal Fix (Add to setup(), after line 248)

```cpp
void setup() {
  Serial.begin(115200);
  delay(1000);

  // *** ADD THESE TWO LINES ***
  analogSetAttenuation(ADC_11db);  // 0-3.3V range for battery monitoring
  analogReadResolution(12);         // 12-bit resolution (0-4095)

  // Disable I2C logging noise...
  // (rest of setup)
}
```

### Better Fix (Replace lines 552-553)

```cpp
// Replace this:
int adcValue = analogRead(BATTERY_PIN);
sensorData.battery_voltage = (adcValue / 4095.0) * 3.3 * BATTERY_VOLTAGE_DIVIDER;

// With this:
float batteryMillivolts = analogReadMilliVolts(BATTERY_PIN);
sensorData.battery_voltage = (batteryMillivolts * 2.0) / 1000.0;  // Account for divider, convert to V
```

---

**Next Step:** Implement the ADC configuration fix and report back with results after 30 minutes of charging.
