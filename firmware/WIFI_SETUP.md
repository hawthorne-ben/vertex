# WiFi Configuration Guide

The BNO055 web server needs to be configured to connect to your home WiFi network.

## Step 1: Edit WiFi Credentials

Open `bno055_webserver.ino` and update these lines:

```cpp
// WiFi credentials - CONFIGURE THESE FOR YOUR NETWORK
const char* ssid = "YOUR_WIFI_NETWORK_NAME";      // Change to your WiFi name
const char* password = "YOUR_WIFI_PASSWORD";       // Change to your WiFi password
```

**Example:**
```cpp
const char* ssid = "MyHomeWiFi";           // Your WiFi network name
const char* password = "super-secret-123"; // Your WiFi password
```

## Step 2: Upload and Connect

1. Upload the sketch to your Feather ESP32 V2
2. Open Serial Monitor (115200 baud)
3. Watch for connection status

## Expected Serial Output

```
========================================
    BNO055 Web Server
========================================

[SETUP] Initializing sensor... OK
[SETUP] Connecting to WiFi: YourNetworkName
.....
[OK] WiFi connected!
[INFO] IP Address: 192.168.1.123
[INFO] Signal Strength (RSSI): -45 dBm
[INFO] Web server started!

========================================
Ready! Visit:
http://192.168.1.123
========================================
```

## Step 3: Access Dashboard

From any device on your network:
- Open a web browser
- Navigate to the IP address shown in Serial Monitor
- You should see the IMU dashboard

## Troubleshooting

### "Failed to connect to WiFi"
- **Check credentials**: WiFi name and password are case-sensitive
- **Check network**: Make sure your network is 2.4GHz (ESP32 doesn't support 5GHz)
- **Check distance**: Device may be too far from router
- **Check special characters**: Some special characters in SSID/password may cause issues

### "Connecting..." but never connects
- Wait up to 15 seconds (30 attempts × 500ms)
- Check Serial Monitor for error messages
- Try restarting your router
- Check if your router has device connection limits

### Can't access from other devices
- Make sure both devices are on the same WiFi network
- Check firewall settings on your computer
- Try the IP address shown in Serial Monitor (not a custom one)
- Some networks isolate devices - you may need to enable device communication in router settings

### Wrong IP address
- The IP is assigned by your router via DHCP
- It may change if device is disconnected/reconnected
- Check Serial Monitor for current IP after each boot

## Security Note

**Important**: This device serves over HTTP (not HTTPS). Anyone on your network can access it.

For better security in production:
- Use HTTPS with certificates
- Add authentication to the web interface
- Consider using mDNS (e.g., `http://imulogger.local`) instead of IP addresses

## Advanced: Static IP (Optional)

If you want a fixed IP address, you can configure one in the setup() function:

```cpp
// Set static IP (optional)
IPAddress local_IP(192, 168, 1, 123);  // Your desired IP
IPAddress gateway(192, 168, 1, 1);     // Your router's IP
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);      // Google DNS

if (!WiFi.config(local_IP, gateway, subnet, primaryDNS)) {
  Serial.println("Failed to configure static IP");
}
```

Add this before `WiFi.begin()` in the setup function.

## Network Requirements

- **2.4GHz WiFi only** (ESP32 doesn't support 5GHz)
- **No enterprise authentication** (WPA2-Personal is supported, WPA2-Enterprise may not work)
- **Same subnet** as other devices you want to access from

