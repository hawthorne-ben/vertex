# BNO055 Connection Guide for Feather ESP32 V2

## Wiring Diagram

The BNO055 uses a **4-pin JST connector** (STEMMA QT / Qwiic compatible). Here's how to connect it:

### JST 4-Pin Cable Wiring

| Cable Color | Function | Feather ESP32 V2 Pin |
|-------------|----------|----------------------|
| **Black**   | GND (Ground) | Any GND pin |
| **Red**     | VCC (Power) | **3V** pin (NOT 5V!) |
| **Blue**    | SCL (Clock) | **SCL** pin |
| **Yellow**  | SDA (Data)  | **SDA** pin |

## Connection Steps

### Option 1: Direct Connection (If you have the cables)

If you have the 4-pin JST connector, you can directly plug it into the sensor. However, you'll need to connect the other end to:

1. **Power (Red wire)**: Connect to **3V** pin on Feather ESP32 V2
2. **Ground (Black wire)**: Connect to **GND** pin on Feather ESP32 V2
3. **SCL (Blue wire)**: Connect to **SCL** pin on Feather ESP32 V2
4. **SDA (Yellow wire)**: Connect to **SDA** pin on Feather ESP32 V2

### Option 2: Using a Breadboard (More Secure)

If you don't have proper connectors:

1. Insert the 4-pin JST connector into the sensor
2. Solder or crimp wires to the JST connector leads
3. Insert those wires into a breadboard
4. Run jumper wires from the breadboard to the Feather ESP32 V2

### Option 3: STEMMA QT Cable (Easiest)

If you have a STEMMA QT cable:
- One end plugs into the BNO055 sensor
- The other end connects to the Feather ESP32 V2 STEMMA QT port (if available)

## Feather ESP32 V2 Pin Locations

Looking at your Feather board with the USB port at the bottom:

```
      USB-C Port
         ║
    ┌────────────┐
    │   Feather  │
    │   ESP32    │
    │     V2     │
    │            │
    │   [SCL]    │ ← I2C Clock (upper left area)
    │   [SDA]    │ ← I2C Data (upper left area)
    │            │
    │   [3V]     │ ← 3.3V Power (near top)
    │   [GND]    │ ← Ground (multiple available)
    │            │
    │            │
    └────────────┘
```

## Important Notes

### ⚠️ Voltage Warning
- The BNO055 runs on **3.3V**, NOT 5V
- Connecting to 5V will damage the sensor
- Always use the **3V** pin, not the **5V** pin

### I2C Pull-up Resistors
- The Adafruit BNO055 breakout board has built-in 10K pull-up resistors
- The Feather ESP32 V2 does NOT have pull-up resistors
- This works perfectly because the sensor provides them

### Power Consumption
- The BNO055 draws about 12-15mA
- Make sure your power source can handle it
- When powered by battery, this will reduce battery life

## Verification

### Hardware Check
1. ✅ Red wire connected to **3V** (not 5V)
2. ✅ Black wire connected to **GND**
3. ✅ Blue wire connected to **SCL**
4. ✅ Yellow wire connected to **SDA**
5. ✅ All connections secure and not loose

### Software Check
1. Upload `bno055_validation.ino` to your Feather
2. Open Serial Monitor at **115200 baud**
3. You should see:
   - "✓ BNO055 sensor found!"
   - Continuous data output
4. Move the sensor and verify data changes

## Troubleshooting

### Sensor Not Detected
- **Check power**: Red wire to **3V** (not 5V or GND)
- **Check connections**: All wires secure
- **Check I2C wiring**: Blue to SCL, Yellow to SDA (not swapped)
- **Check ground**: Black wire must be connected

### All Values Are Zero
- **Calibration needed**: Move sensor in figure-8 pattern
- **Wait longer**: Sensor needs time to initialize (1-2 seconds)
- **Check firmware**: Make sure libraries are installed

### Sensor Detected But No Data Changes
- **Calibration required**: Move sensor through all orientations
- **Check sampling rate**: Increase delay if needed
- **Verify connections**: Re-check all wires

## Next Steps

Once the sensor is working:
1. Verify all sensor axes respond to movement
2. Check calibration status (should go from 0 to 3)
3. Test at different orientations
4. Proceed to data logging implementation

## Safety Reminders

- ⚠️ Never connect power backwards
- ⚠️ Use 3.3V only (3V pin)
- ⚠️ Double-check all connections before powering on
- ⚠️ Keep wiring neat and secure
- ⚠️ Avoid loose connections that could short circuit
