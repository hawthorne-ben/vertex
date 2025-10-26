# Security Setup Quick Reference

## Quick Start

1. **Copy credentials template:**
   ```bash
   cp credentials.h.template credentials.h
   ```

2. **Edit credentials.h** with your WiFi and web credentials

3. **Upload firmware:**
   ```bash
   ./upload.sh
   ```

4. **Access web interface** at the IP address shown in Serial Monitor

5. **Login** with the credentials you set in `credentials.h`

## What's Protected

- ✅ All web endpoints (`/` and `/sensor`) now require authentication
- ✅ Credentials stored in gitignored `credentials.h` file
- ✅ No sensitive data in version control

## Configuration File

Edit `credentials.h`:
- `WIFI_SSID` - Your WiFi network name
- `WIFI_PASSWORD` - Your WiFi password
- `WEB_USERNAME` - Login username (default: admin)
- `WEB_PASSWORD` - Login password (CHANGE THIS!)
- `API_KEY` - For future API endpoints

See `../SECURITY_SETUP.md` for detailed instructions.

