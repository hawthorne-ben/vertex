# Deployment Guide

This guide covers deploying the Vertex web app to Vercel and building the Android APK for production.

---

## 🗂️ Monorepo Structure

**Important:** This project uses a monorepo structure:

```
vertex/                              ← Project root (Web app)
├── src/                             ← Next.js web app code
├── public/                          ← Web app assets
├── package.json                     ← Web app dependencies
├── vercel.json                      ← Vercel config
├── android/
│   └── vertex/                      ← Android app directory
│       ├── src/                     ← React Native code
│       ├── android/                 ← Native Android code
│       ├── package.json             ← Android app dependencies
│       └── build-release.sh         ← APK build script
└── ...
```

**Where to run commands:**
- **Web app commands**: Run from project root (`/Users/bhawthorne/dev/vertex/`)
- **Android app commands**: Run from `android/vertex/` directory

---

## Prerequisites

- Node.js 18+ installed
- Vercel CLI: `npm i -g vercel`
- Android Studio with SDK installed
- ADB tools installed

## Web App Deployment (Vercel)

**📂 All commands in this section run from: Project root**

```bash
# Navigate to project root
cd /Users/bhawthorne/dev/vertex
```

### 1. Initial Setup

If this is your first deployment:

```bash
# Login to Vercel (from project root)
vercel login

# Link your project (from project root)
vercel link
```

### 2. Configure Environment Variables

Set these in the Vercel dashboard (Settings → Environment Variables):

**Required:**
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Your Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key (secret)
- `NEXTAUTH_SECRET` - NextAuth secret key
- `NEXTAUTH_URL` - Your production URL (e.g., https://vertex.vercel.app)

**Optional:**
- `INNGEST_EVENT_KEY` - For background job processing
- `INNGEST_SIGNING_KEY` - For Inngest security

### 3. Deploy to Production

**📂 Run from: Project root** (`/Users/bhawthorne/dev/vertex/`)

```bash
# Make sure you're in the project root
pwd  # Should show: /Users/bhawthorne/dev/vertex

# Preview deployment (test first)
vercel

# Production deployment
vercel --prod
```

### 4. Verify Deployment

Visit your deployment URL and test:
- Authentication works
- Database connection is functional
- File uploads work

## Android App Production Build

**📂 All commands in this section run from: `android/vertex/`**

```bash
# Navigate to Android app directory
cd /Users/bhawthorne/dev/vertex/android/vertex
```

### 1. Update Production Environment

Edit `android/vertex/.env.production`:

```env
SUPABASE_URL=https://gdctvplxiogaicjpbvee.supabase.co
SUPABASE_ANON_KEY=your-anon-key
API_BASE_URL=https://your-vercel-app.vercel.app
```

### 2. Build Release APK

**📂 Run from: `android/vertex/`**

```bash
# Make sure you're in the Android app directory
pwd  # Should show: /Users/bhawthorne/dev/vertex/android/vertex

# Build the APK
./build-release.sh
```

The APK will be created at:
```
android/vertex/android/app/build/outputs/apk/release/app-release.apk
```

### 3. Install on Device

**📂 Run from: `android/vertex/`**

```bash
# Install via ADB
adb install android/app/build/outputs/apk/release/app-release.apk

# Or manually transfer the APK to your device
```

## Production Signing (Required for Play Store)

**📂 Run from: `android/vertex/`**

### 1. Generate Production Keystore

```bash
# Navigate to Android app directory
cd /Users/bhawthorne/dev/vertex/android/vertex/android/app

# Generate keystore
keytool -genkeypair -v \
  -storetype PKCS12 \
  -keystore vertex-release.keystore \
  -alias vertex-key \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

**Save these securely:**
- Keystore password
- Key alias: `vertex-key`
- Key password

### 2. Configure Signing in build.gradle

Edit `android/vertex/android/app/build.gradle`:

```gradle
android {
    ...
    signingConfigs {
        release {
            if (project.hasProperty('VERTEX_RELEASE_STORE_FILE')) {
                storeFile file(VERTEX_RELEASE_STORE_FILE)
                storePassword VERTEX_RELEASE_STORE_PASSWORD
                keyAlias VERTEX_RELEASE_KEY_ALIAS
                keyPassword VERTEX_RELEASE_KEY_PASSWORD
            }
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled enableProguardInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
        }
    }
}
```

### 3. Create gradle.properties

Create `android/vertex/android/gradle.properties`:

```properties
VERTEX_RELEASE_STORE_FILE=app/vertex-release.keystore
VERTEX_RELEASE_STORE_PASSWORD=your-keystore-password
VERTEX_RELEASE_KEY_ALIAS=vertex-key
VERTEX_RELEASE_KEY_PASSWORD=your-key-password
```

**⚠️ Never commit this file to git!**

### 4. Build Signed Release

**📂 Run from: `android/vertex/`**

```bash
cd android
./gradlew assembleRelease
```

## Environment Management

### Development
- Web: Uses `.env.local`
- Android: Uses `.env` (local Supabase)

### Production
- Web: Uses Vercel environment variables
- Android: Uses `.env.production` (copied to `.env` during build)

## Testing Production Build

### Before Deploying:

1. **Test Web App Locally (from project root):**
   ```bash
   cd /Users/bhawthorne/dev/vertex
   npm run build
   npm start
   ```

2. **Test Android APK (from android/vertex):**
   ```bash
   # Navigate to Android app
   cd /Users/bhawthorne/dev/vertex/android/vertex

   # Build and install
   ./build-release.sh
   adb install android/app/build/outputs/apk/release/app-release.apk
   ```

3. **Verify:**
   - Authentication works
   - BLE device scanning works
   - Data syncs to production database
   - No console errors

## Troubleshooting

### Vercel Deployment Fails
- Check build logs in Vercel dashboard
- Verify all environment variables are set
- Test build locally: `npm run build`

### Android Build Fails
- Clean build: `cd android && ./gradlew clean`
- Check `.env.production` exists
- Verify React Native dependencies: `npm install`

### APK Won't Install
- Uninstall previous version first
- Check minimum Android version (API 23+)
- Verify APK signature: `keytool -printcert -jarfile app-release.apk`

## Security Notes

1. **Never commit:**
   - `.env` files with real credentials
   - Keystore files
   - `gradle.properties` with passwords

2. **Rotate credentials:**
   - After any suspected leak
   - Periodically (every 90 days)

3. **Use Vercel environment variables:**
   - For all production secrets
   - Enable "Encrypt" option for sensitive values

## Monitoring

### Web App
- Check Vercel Analytics dashboard
- Monitor error logs in Vercel
- Set up Sentry for error tracking (optional)

### Android App
- Monitor crash reports (Firebase Crashlytics recommended)
- Check Play Console for user feedback

## Updates

### Web App (from project root)
```bash
cd /Users/bhawthorne/dev/vertex
git push origin main
vercel --prod
```

### Android App (from android/vertex)
1. Update version in `android/vertex/android/app/build.gradle`:
   ```gradle
   versionCode 2  // Increment
   versionName "1.1"
   ```
2. Build new APK:
   ```bash
   cd /Users/bhawthorne/dev/vertex/android/vertex
   ./build-release.sh
   ```
3. Distribute via Play Store or direct download

## Rollback

### Vercel (from project root)
```bash
cd /Users/bhawthorne/dev/vertex
vercel list
vercel rollback <deployment-url>
```

### Android
- Keep previous APK versions
- Can't rollback installed apps
- Users must install previous version manually

---

## Quick Reference

### From Project Root (`/Users/bhawthorne/dev/vertex/`)
```bash
# Deploy web app
vercel --prod

# View web app logs
vercel logs
```

### From Android App (`/Users/bhawthorne/dev/vertex/android/vertex/`)
```bash
# Build Android APK
./build-release.sh

# Install on device
adb install android/app/build/outputs/apk/release/app-release.apk
```

### Typical Workflow
```bash
# 1. Deploy web app first
cd /Users/bhawthorne/dev/vertex
vercel --prod

# 2. Update Android .env.production with new Vercel URL
cd android/vertex
# Edit .env.production

# 3. Build Android APK
./build-release.sh

# 4. Install on device
adb install android/app/build/outputs/apk/release/app-release.apk
```
