# BNO055 Firmware Security Setup

This guide explains how to configure security credentials for the BNO055 Dual-Mode Logger.

## Security Features

The firmware now includes:

1. **HTTP Basic Authentication** - Protects web interface from unauthorized access
2. **Encrypted Credentials** - WiFi and web credentials stored separately from code
3. **Git-ignored Secrets** - Credentials are never committed to version control

## Setup Instructions

### Step 1: Configure Credentials

1. Navigate to the firmware directory:
   ```bash
   cd firmware/bno055_dual_mode
   ```

2. Copy the template file:
   ```bash
   cp credentials.h.template credentials.h
   ```

3. Edit `credentials.h` with your actual values:
   ```cpp
   #define WIFI_SSID "YourWiFiName"
   #define WIFI_PASSWORD "YourWiFiPassword"
   #define WEB_USERNAME "admin"
   #define WEB_PASSWORD "YourSecurePassword"
   #define API_KEY "YourRandomAPIKey"
   ```

**Important Security Notes:**
- Use a strong password for `WEB_PASSWORD`
- Generate a random API key for `API_KEY` (e.g., use an online generator)
- WiFi credentials are case-sensitive

### Step 2: Upload Firmware

After configuring credentials, upload the firmware:

```bash
# From the firmware directory
./upload.sh

# Or use the simple version
./upload-simple.sh
```

### Step 3: Access the Web Interface

When you access the web interface, you'll be prompted for credentials:

- **Username:** (value of `WEB_USERNAME` from credentials.h)
- **Password:** (value of `WEB_PASSWORD` from credentials.h)

## Default Credentials

⚠️ **WARNING:** The default credentials are:
- **Username:** `admin`
- **Password:** `CHANGE_THIS_TO_SOMETHING_SECURE`

**You MUST change these before deploying!**

## Security Recommendations

1. **Change Default Password:** Always use a strong, unique password
2. **Use WPA2 WiFi:** Ensure your WiFi network uses WPA2 encryption
3. **Limit Network Access:** Only connect the device to trusted networks
4. **Regular Updates:** Update firmware regularly for security patches

## Troubleshooting

### "Authentication Required" Popup Won't Go Away

- Verify you're using the correct username and password from `credentials.h`
- Check that credentials are properly set in the file
- Try hard refresh (Ctrl+Shift+R or Cmd+Shift+R)

### Can't Connect to WiFi

- Verify WiFi credentials in `credentials.h`
- Ensure you're using 2.4GHz WiFi (ESP32 doesn't support 5GHz)
- Check that credentials are properly formatted (no extra spaces, correct quotes)

### Forgot Credentials

If you forget your credentials, you'll need to:
1. Re-flash the firmware
2. Update `credentials.h` with new credentials
3. Re-upload to the device

## HTTPS Support

Currently, the firmware uses HTTP. HTTPS support with SSL certificates can be added but requires:
- Additional Flash memory for certificate storage
- More RAM for SSL handshakes
- Complexity in certificate management

For local network use, HTTP Basic Auth is sufficient. For production deployments over the internet, consider:
- Using a VPN to access the device
- Adding SSL/TLS support (See `FIRMWARE_HTTPS.md` for advanced setup)

## Git Ignore

The following files are gitignored (never committed):
- `credentials.h` - Contains actual credentials
- `.credentials.local` - Alternative credential storage (not currently used)

Files that ARE committed:
- `credentials.h.template` - Template for new setups
- `config.h` - Non-sensitive configuration

## Advanced: Certificate-based HTTPS

For additional security, you can implement HTTPS with self-signed certificates. See:
- `docs/firmware/HTTPS_SETUP.md` (create this file if needed)
- ESP32 Arduino: `WiFiServerSecure` for HTTPS support

## Additional Security Considerations

1. **API Key Usage:** The `API_KEY` is defined but not currently used. Future API endpoints can validate requests using this key.

2. **Password Management:**
   - Store production credentials securely
   - Never commit credentials.h to git
   - Use a password manager to generate strong passwords

3. **Network Security:**
   - Place device on isolated IoT network if possible
   - Use strong WiFi passwords (WPA2)
   - Monitor device connections

## Emergency Access

If you lock yourself out:
1. Re-flash firmware with updated credentials
2. Serial monitor will show connection status
3. Check firmware/bno055_dual_mode/upload.log for errors

