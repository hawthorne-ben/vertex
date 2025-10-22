# Vertex Deployment Guide

## Quick Start - Deploy to Vercel

### 1. Prerequisites
- GitHub account with this repository pushed
- Vercel account (free tier works perfectly)
- Vercel CLI installed globally: `npm install -g vercel`

### 2. Manual Deployment (Recommended)

Since auto-deploy is disabled for better control, use manual deployment:

1. **Build and Test Locally**
   ```bash
   npm run build
   ```

2. **Deploy to Production**
   ```bash
   vercel --prod
   ```

3. **Deploy Preview/Staging**
   ```bash
   vercel
   ```

### 3. Environment Variables Setup

**Required for full functionality:**
```bash
# Add these in Vercel dashboard or via CLI:
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY  
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add INNGEST_SIGNING_KEY
vercel env add INNGEST_EVENT_KEY
```

**Optional (for authentication):**
```bash
vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
vercel env add CLERK_SECRET_KEY
```

### 4. Deployment Commands Reference

```bash
# Production deployment
vercel --prod

# Preview deployment  
vercel

# Check deployment status
vercel ls

# View logs
vercel logs [deployment-url]

# Pull environment variables
vercel env pull .env.local

# Add environment variable
vercel env add VARIABLE_NAME

# Remove environment variable
vercel env rm VARIABLE_NAME
```

### 5. Auto-Deploy Status

**Auto-deploy is DISABLED** for manual control. To re-enable:
```bash
vercel git connect
```

To disable again:
```bash
vercel git disconnect
```

## Local Development

### First Time Setup
```bash
npm install
```

### Run Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

### Build for Production
```bash
npm run build
npm start
```

## Project Structure

```
vertex/
├── src/
│   ├── app/              # Next.js App Router pages
│   │   ├── layout.tsx    # Root layout with fonts
│   │   ├── page.tsx      # Landing page
│   │   └── globals.css   # Global styles
│   ├── components/
│   │   └── ui/           # shadcn/ui components
│   └── lib/
│       └── utils.ts      # Utility functions
├── public/               # Static assets
├── package.json          # Dependencies
├── next.config.ts        # Next.js configuration
├── tailwind.config.ts    # Tailwind configuration
├── tsconfig.json         # TypeScript configuration
└── vercel.json           # Vercel deployment configuration
```

## Tech Stack Included

✅ **Next.js 15** with App Router  
✅ **TypeScript** for type safety  
✅ **Tailwind CSS** for styling  
✅ **Crimson Pro** (serif) and **JetBrains Mono** fonts  
✅ **shadcn/ui** component library  
✅ **All core dependencies installed:**
  - **Supabase** (database & storage)
  - **Inngest** (background job processing)
  - **TanStack Query** (data fetching)
  - **Papa Parse** (CSV parsing)
  - **Recharts** (data visualization)
  - **React Dropzone** (file uploads)
  - **Lucide React** (icons)
  - And more...

## Current Features

✅ **Complete Upload Flow**
- File confirmation modal
- Upload progress tracking
- Real-time processing status
- Auto-redirect to data page

✅ **Background Processing**
- Inngest-powered CSV parsing
- Batch database inserts
- Comprehensive error handling
- Retry mechanisms

✅ **Real-time UI Updates**
- Status polling for processing files
- Live progress indicators
- Error state handling

✅ **Observability**
- Health check endpoints
- Detailed logging
- Retry stuck uploads functionality

## Vercel Configuration

The `vercel.json` file is configured for optimal Next.js deployment:
- Automatic framework detection
- Optimized build process
- Edge network deployment

No additional configuration needed for basic deployment.

## Troubleshooting

### Build Fails
- Check `npm run build` locally first
- Ensure all dependencies are in `package.json`
- Check Node version compatibility (Node 18+ recommended)
- Fix ESLint errors before deploying

### Environment Variables Missing
- Use `vercel env ls` to check current variables
- Add missing variables with `vercel env add VARIABLE_NAME`
- Pull local variables with `vercel env pull .env.local`

### Inngest Functions Not Working
- Check `vercel logs` for function execution errors
- Verify `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` are set
- Test locally with `npx inngest-cli@latest dev`

### Upload Issues
- Check Supabase storage permissions
- Verify `SUPABASE_SERVICE_ROLE_KEY` is set
- Monitor logs for CSV parsing errors

### Function Registration Issues
- Check `/api/inngest` endpoint returns function count
- Verify all function imports are working
- Look for import errors in build logs

## Next Steps

The application is now **production-ready** with:

✅ **Complete Upload & Processing Pipeline**
- File upload with confirmation
- Background CSV parsing
- Real-time status updates
- Error handling & retries

✅ **Production Deployment**
- Manual deployment control
- Environment variable management
- Comprehensive logging
- Health monitoring

**Ready for:**
1. **Production deployment**: `vercel --prod`
2. **User testing** with real IMU data files
3. **Feature expansion** (visualization, analysis tools)
4. **Performance optimization** for larger datasets

The foundation is solid - deploy and start collecting real user feedback! 🚀

