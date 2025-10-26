# Quick Start: Deploy to Production

Follow these steps to deploy your Vertex app to production.

---

## 📁 Important: Where to Run Commands

**Monorepo Structure:**
```
vertex/                    ← Root (Web app)
├── src/                   ← Next.js web app
├── android/
│   └── vertex/            ← Android app
└── ...
```

**Run commands in:**
- **Web app**: From project root (`/Users/bhawthorne/dev/vertex/`)
- **Android app**: From `android/vertex/` directory

---

## Step 1: Deploy Web App to Vercel (5 minutes)

**📂 Run from: Project root** (`cd /Users/bhawthorne/dev/vertex`)

```bash
# 1. Install Vercel CLI (if not already installed)
npm i -g vercel

# 2. Login to Vercel
vercel login

# 3. Deploy to production (from project root!)
vercel --prod
```

**After deployment:**
1. Go to Vercel dashboard → Your Project → Settings → Environment Variables
2. Add these variables:
   - `NEXT_PUBLIC_SUPABASE_URL`: `https://gdctvplxiogaicjpbvee.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: (your anon key from `.env.local`)
   - `SUPABASE_SERVICE_ROLE_KEY`: (your service role key)
   - `NEXTAUTH_SECRET`: (your NextAuth secret)
   - `NEXTAUTH_URL`: Your Vercel URL (e.g., `https://vertex.vercel.app`)

3. Redeploy: `vercel --prod`

Your web app is now live! 🎉

## Step 2: Configure Android for Production (2 minutes)

**📂 Run from: Android app directory**

```bash
# From project root, navigate to Android app
cd android/vertex

# Edit .env.production and update API_BASE_URL with your Vercel URL
```

In `.env.production`, change:
```env
API_BASE_URL=https://your-vercel-url.vercel.app
```

## Step 3: Build Production APK (3 minutes)

**📂 Run from: Android app directory** (`android/vertex/`)

```bash
# Make sure you're in android/vertex directory!
pwd  # Should show: /Users/bhawthorne/dev/vertex/android/vertex

# Build the APK
./build-release.sh
```

The APK will be at: `android/app/build/outputs/apk/release/app-release.apk`

## Step 4: Install on Your Device

**📂 Run from: Android app directory** (`android/vertex/`)

```bash
# Connect your phone via USB and enable USB debugging
adb install android/app/build/outputs/apk/release/app-release.apk
```

Or transfer the APK to your phone and install manually.

Done! Your app is now running against production! 🚀

---

## Testing Checklist

Before sharing with users:

- [ ] Web app loads at production URL
- [ ] Can create account and login
- [ ] Android app connects to production
- [ ] BLE device scanning works
- [ ] Heart rate polling works on Whoop
- [ ] Data saves to production database
- [ ] Can view saved devices

---

## Quick Commands Reference

### Web App (from project root)
```bash
# Redeploy to Vercel
cd /Users/bhawthorne/dev/vertex
vercel --prod

# View deployment logs
vercel logs
```

### Android App (from android/vertex)
```bash
# Rebuild APK
cd /Users/bhawthorne/dev/vertex/android/vertex
./build-release.sh

# View app logs
adb logcat | grep ReactNativeJS

# Install APK on device
adb install android/app/build/outputs/apk/release/app-release.apk
```

---

For detailed information, see [DEPLOYMENT.md](./DEPLOYMENT.md)
