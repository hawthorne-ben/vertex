# STEMMA QT Connection Troubleshooting

## Why It Should Work

Your hardware is all STEMMA QT compatible:
- **Feather ESP32 V2**: Has STEMMA QT connector
- **BNO055**: Has STEMMA QT connector
- **JST SH 4-pin cable**: STEMMA QT compatible

They should plug directly together!

## Wiring Standard

STEMMA QT uses a 4-pin standard (left to right looking at the connector):

| Pin | Color | Function |
|-----|-------|----------|
| 1   | Black | GND      |
| 2   | Red   | 3.3V     |
| 3   | Blue  | SCL      |
| 4   | Yellow| SDA      |

## Common Issues

### 1. Connector Orientation
- STEMMA QT connectors are keyed - they should only fit one way
- If it doesn't snap in, flip it over and try again

### 2. Power from Battery vs USB
If you're powered by the LiPo battery, make sure:
- Battery is charged (LED should be on when plugged in to charge)
- Battery is properly connected to the JST connector on the Feather

### 3. Hardware Check Without Cable
Test if the STEMMA QT connector on the Feather works:
- The sketch will still run even if no sensor is connected
- You'll see the error message if sensor not detected

## Quick Test Steps

1. **Verify Feather is powered**:
   - LED should be on or blink
   - Serial Monitor should show messages

2. **Connect cable**:
   - Cable → BNO055 (should snap in)
   - Cable → Feather ESP32 V2 STEMMA QT port
   - Should snap in securely

3. **Upload and run sketch**:
   - Open Serial Monitor at 115200 baud
   - Should see either success or clear error message

## If Sensor Not Detected

Check these in order:

1. **Is Feather powered?**
   - Check LED indicator
   - Try USB power instead of battery

2. **Are connectors fully seated?**
   - Push firmly on both ends
   - Should hear/feel a click

3. **Try different I2C address**:
   - Some BNO055 variants use 0x29 instead of 0x28
   - Check the board - there might be a small switch or solder jumper

4. **Check Serial Monitor output**:
   - Clear error messages will tell you exactly what's wrong
   - Look for "Wire.begin()" or I2C-related errors

## Direct Connection Test

If direct connection doesn't work, try with jumper wires:

1. Disconnect the STEMMA QT cable
2. Connect individual wires:
   - BNO055 GND → Feather GND
   - BNO055 3V → Feather 3V
   - BNO055 SCL → Feather SCL  
   - BNO055 SDA → Feather SDA
3. This isolates whether the problem is the cable or something else
