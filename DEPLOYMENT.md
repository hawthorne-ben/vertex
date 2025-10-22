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

### 3. Development Workflow (Local First)

**Priority Order:**
1. **Local Development** (Preferred for debugging)
   ```bash
   # Terminal 1: Start Next.js dev server
   npm run dev
   
   # Terminal 2: Start Inngest dev server  
   npm run dev:inngest
   ```
   - ✅ **Faster iterations** (no deployment time)
   - ✅ **No deployment costs** (production won't be free forever)
   - ✅ **Easier debugging** (direct access to logs)
   - ✅ **Real-time changes** (hot reload)

   **⚠️ Hot Reload Reliability:**
   - Hot reload can be flaky, especially with complex changes
   - **Always restart dev server** when testing new features: `npm run dev:clean`
   - Restart both servers when making significant changes

   **🗄️ Development Database Setup:**
   - Use separate Supabase dev project to avoid conflicts with production
   - See [Development Database Setup](#development-database-setup) section below

2. **Production Deployment** (Only when needed)
   ```bash
   vercel --prod  # Deploy without committing (debugging)
   ```
   - Use only when local environment differs significantly
   - Or when testing production-specific features

**Debugging Pattern (Keep Git History Clean):**
- Use `vercel --prod` to deploy without committing to git
- This keeps git history clean while allowing rapid iteration
- Only commit when features are complete and tested

**Benefits:**
- ✅ Clean git history
- ✅ Faster debugging cycles  
- ✅ Easy rollbacks
- ✅ No "debugging commits" cluttering the log

## Development Database Setup

### Why Use a Separate Dev Database?

- **🛡️ Safety**: Avoid accidentally affecting production data
- **🧪 Testing**: Clean environment for testing new features
- **🔄 Isolation**: Can reset/rebuild dev database without affecting prod
- **📊 Performance**: Dev database won't impact production performance

### Setup Steps

1. **Create Supabase Dev Project**
   - Go to [Supabase Dashboard](https://supabase.com/dashboard)
   - Click "New Project"
   - Name: `vertex-dev`
   - Use same region as production
   - Generate strong database password

2. **Configure Environment Variables**
   ```bash
   # Copy the template
   cp env.local.dev.template .env.local
   
   # Edit .env.local with your dev database credentials
   NEXT_PUBLIC_SUPABASE_URL=https://your-dev-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-dev-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-dev-service-role-key
   ```

3. **Set Up Database Schema**
   - Go to your dev project SQL Editor
   - Run the contents of `dev-database-setup.sql`
   - This creates all tables, indexes, and RLS policies

4. **Test the Setup**
   ```bash
   # Restart dev servers with new environment
   pkill -f "next dev" && npm run dev
   npx inngest-cli@latest dev
   
   # Test upload and parsing
   # Go to http://localhost:3000/upload
   ```

### Switching Between Environments

**For Development:**
```bash
# Use dev database
cp env.local.dev.template .env.local
# Edit .env.local with dev credentials
```

**For Production Testing:**
```bash
# Use production database
vercel env pull .env.local
```

### Database Schema Management

- **Schema Changes**: Update `dev-database-setup.sql` first
- **Test in Dev**: Apply changes to dev database
- **Deploy to Prod**: Apply same changes to production
- **Version Control**: Keep schema changes in git

#### Schema Migrations with Supabase CLI

The Supabase CLI is configured and can apply schema migrations directly:

```bash
# Apply schema changes to linked project
npx supabase db push --file schema-enhancements-phase1.sql

# Apply streaming enhancements
npx supabase db push --file schema-streaming-enhancements.sql

# Apply RLS policy fixes
npx supabase db push --file fix-rls-policies-corrected.sql
```

**Benefits:**
- ✅ **Direct application** - No manual copy/paste in dashboard
- ✅ **Version controlled** - Schema changes tracked in git
- ✅ **Consistent** - Same changes applied to dev and prod
- ✅ **Automated** - Can be integrated into deployment scripts

**Note:** The AI assistant can create and apply schema migrations for debugging and enhancements.

### Troubleshooting

**Common Issues:**
- **"Table doesn't exist"**: Run `dev-database-setup.sql` in dev project
- **"Permission denied"**: Check RLS policies are created
- **"Storage bucket missing"**: Verify storage bucket creation in SQL
- **"Environment variables"**: Double-check `.env.local` has dev credentials

### 4. Environment Variables Setup

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

