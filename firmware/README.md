# BNO055 Firmware

This directory contains firmware for the Adafruit BNO055 IMU sensor running on the Adafruit Feather ESP32 V2.

## Firmware Sketches

### Testing/Development
- **bno055_validation.ino** - Basic sensor validation sketch (Serial Monitor output)
- **bno055_webserver.ino** - Web server with real-time dashboard UI (development version)

### Production
- **bno055_dual_mode/** - Complete dual-mode firmware (charging/logging modes)
  - See `bno055_dual_mode/README.md` for full documentation

## Documentation Files

- **BNO055_CONNECTION_GUIDE.md** - Complete wiring and connection guide
- **TROUBLESHOOTING.md** - STEMMA QT connection troubleshooting
- **CALIBRATION_GUIDE.md** - Sensor calibration instructions
- **SENSOR_EXPLAINED.md** - Understanding BNO055 data
- **I2C_TROUBLESHOOTING.md** - I2C error handling and recovery
- **DUAL_MODE_DESIGN.md** - Dual-mode architecture documentation

## Quick Start

### 1. Install Required Libraries

In Arduino IDE, install these libraries:
- **Adafruit BNO055** (by Adafruit)
- **Adafruit Unified Sensor** (by Adafruit)

Via Sketch → Include Library → Manage Libraries

### 2. Hardware Setup

Connect BNO055 to Feather ESP32 V2 using STEMMA QT cable:
- Cable plugs directly into both devices
- No additional wiring needed
- Sensor has pull-up resistors built-in

See `BNO055_CONNECTION_GUIDE.md` for detailed wiring info.

### 3. Upload Firmware

1. Open Arduino IDE
2. Select Board: **Tools → Board → ESP32 Arduino → Adafruit Feather ESP32 V2**
3. Select Port: **Tools → Port → [your COM port]**
4. Open one of the sketches (`bno055_webserver.ino` recommended)
5. Upload (Ctrl+U or Upload button)

## Testing the Web Server

### Step-by-Step Instructions

1. **Upload the sketch** (`bno055_webserver.ino`)

2. **Open Serial Monitor** (115200 baud) to see startup messages:
   ```
   ========================================
       BNO055 Web Server
   ========================================
   
   [SETUP] Initializing sensor... OK
   [SETUP] Starting WiFi access point... OK
   [INFO] Access Point: IMU_Logger
   [INFO] Password: vertex123
   [INFO] IP Address: 192.168.4.1
   [INFO] Web server started!
   
   ========================================
   Ready! Connect to WiFi 'IMU_Logger'
   and visit http://192.168.4.1
   ========================================
   ```

3. **On your phone/laptop**, connect to WiFi network:
   - Network: **IMU_Logger**
   - Password: **vertex123**

4. **Open a web browser** and navigate to:
   - http://192.168.4.1

5. **You should see** a beautiful real-time dashboard with:
   - Live sensor data updating every 100ms
   - Orientation (Roll, Pitch, Yaw)
   - Acceleration data
   - Gyroscope data
   - Calibration status
   - Quaternion values
   - Connection status indicator

6. **Test the sensor** by moving it around - all values should update in real-time

### What You'll See

The dashboard displays:

- **📐 Orientation**: Roll, Pitch, Yaw angles in degrees
- **⚡ Acceleration**: Linear acceleration (gravity removed) in m/s²
- **🌀 Gyroscope**: Rotation rates in rad/s
- **✅ Calibration**: Status (0-3) for System, Gyro, Accel, Magnetometer
- **🔢 Quaternion**: Complete orientation representation
- **ℹ️ Info**: Uptime and last update timestamp

### Troubleshooting

**Can't connect to WiFi:**
- Make sure you're connecting to "IMU_Logger" (not looking for it to join your network)
- Password is case-sensitive: "vertex123"
- Check Serial Monitor for IP address

**Sensor not detected:**
- Verify STEMMA QT cable is fully plugged into both devices
- Check power - ensure battery is charged or USB is connected
- See `BNO055_CONNECTION_GUIDE.md` for wiring details

**Page loads but data doesn't update:**
- Check Serial Monitor for errors
- Try refreshing the page
- Ensure you're connected to the IMU_Logger WiFi network

**All values are zero:**
- Move the sensor to initiate calibration
- Wait a few seconds for calibration to complete
- Look for calibration values > 0

For more help, see `TROUBLESHOOTING.md`

## Next Steps

Once the web server is working:

1. **Test sensor accuracy** by placing it in known orientations
2. **Monitor calibration status** - ensure all sensors reach 3
3. **Check data quality** - move sensor slowly and watch for smooth updates
4. **Proceed to data logging** implementation

## Architecture

The web server uses:
- **WiFi Access Point mode**: ESP32 creates its own network
- **WebServer library**: Built-in HTTP server
- **JSON API**: `/data` endpoint returns sensor data
- **Modern UI**: Responsive CSS with live updates via JavaScript

The sketch updates sensor data at 10Hz and serves it to browsers on request.
