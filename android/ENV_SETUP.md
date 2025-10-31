# Environment Setup

The Android app supports multiple environment configurations for local development and production builds.

## Environment Files

- `.env.local` - Local development (points to local web server)
- `.env.production` - Production (points to Vercel deployment)
- `.env.example` - Template file (commit to git)

## Setup

1. Copy `.env.example` to `.env.local` and `.env.production`:
   ```bash
   cp .env.example .env.local
   cp .env.example .env.production
   ```

2. Fill in your credentials in both files

3. Update API_URL for each environment:
   - `.env.local`: Use your local IP (e.g., `http://192.168.1.5:3000`)
   - `.env.production`: Use your Vercel URL (e.g., `https://vertex-indol-six.vercel.app`)

## Finding Your Local IP

**Mac:**
```bash
ipconfig getifaddr en0
```

**Linux:**
```bash
hostname -I | awk '{print $1}'
```

**Windows:**
```bash
ipconfig
```
Look for "IPv4 Address" under your active network adapter.

## NPM Scripts

- `npm run android` - Run with local environment (`.env.local`)
- `npm run android:prod` - Run with production environment (`.env.production`)
- `npm run android:release` - Build release with production environment

## Testing the Upload Feature

### Local Development (Recommended)
1. Start the web dev server: `cd ../web && npm run dev`
2. Update `.env.local` with your local IP
3. Run: `npm run android`
4. Test uploads - they'll hit your local server

### Production Testing
1. Ensure API is deployed to Vercel
2. Run: `npm run android:prod`
3. Test uploads - they'll hit Vercel

## Troubleshooting

**Upload fails with 404:**
- Check that API_URL is correct in your .env file
- For local: Ensure web dev server is running
- For production: Ensure the API endpoint is committed and deployed

**Network request failed:**
- For local: Check that your phone/emulator can reach your computer's IP
- For local: Disable any VPN or firewall blocking local network
- For production: Check internet connectivity
