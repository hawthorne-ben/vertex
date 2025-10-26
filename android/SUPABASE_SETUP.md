# Supabase Setup for Android App

## Environment Variables in React Native

Unlike web apps, React Native doesn't use `.env` files directly at runtime. For this project, we're using a **simple direct configuration** approach.

## How to Configure Supabase

### 1. Get Your Supabase Credentials

1. Go to your [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to **Settings** → **API**
4. Copy:
   - **Project URL** (this is your `SUPABASE_URL`)
   - **anon/public key** (this is your `SUPABASE_ANON_KEY`)

### 2. Update the Supabase Client

Edit the file: `android/vertex/src/lib/supabase.ts`

Replace these lines:
```typescript
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';
```

With your actual credentials:
```typescript
const SUPABASE_URL = 'https://your-actual-project.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

### 3. Reload the App

After updating the credentials:
```bash
# Reload the app on your device
adb shell am force-stop com.vertex
adb shell am start -n com.vertex/.MainActivity
```

Or just shake the device and tap **Reload** in the React Native debug menu.

## Security Note

⚠️ The `.env` file is created but not used by the app yet. 

The credentials are **hardcoded in the source file** for simplicity. This is fine for development, but for production you should:

1. Use a proper environment variable solution like `react-native-config`
2. Use different credentials for dev/prod
3. Never commit real credentials to git

## Current Status

- ✅ `.env` file created at `android/vertex/.env` (not used yet)
- ✅ `.env` is in `.gitignore` (won't be committed)
- ✅ Supabase client expects credentials in `src/lib/supabase.ts`
- ⚠️ Login will fail until you add real credentials

## Testing the Login

After adding your credentials:
1. Open the app
2. Tap **"Get Started"** on the landing screen
3. You should see the login form
4. Try logging in with an existing Supabase user

