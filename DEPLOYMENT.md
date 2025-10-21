# Vertex Deployment Guide

## Quick Start - Deploy to Vercel

### 1. Prerequisites
- GitHub account with this repository pushed
- Vercel account (free tier works perfectly)

### 2. Deploy Steps

1. **Push to GitHub**
   ```bash
   git push origin main
   ```

2. **Connect to Vercel**
   - Go to [vercel.com](https://vercel.com)
   - Click "Add New Project"
   - Import your GitHub repository
   - Vercel will auto-detect Next.js configuration

3. **Configure Environment Variables** (optional for basic POC)
   - Skip for now - the landing page works without any env vars
   - When ready to add features, add these in Vercel dashboard:
     - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
     - `CLERK_SECRET_KEY`
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `INNGEST_SIGNING_KEY`
     - `INNGEST_EVENT_KEY`

4. **Deploy**
   - Click "Deploy"
   - Vercel will build and deploy automatically
   - You'll get a live URL like `vertex-xyz.vercel.app`

### 3. Automatic Deployments

Once connected, every push to `main` will automatically trigger a new deployment.

Preview deployments are created for pull requests.

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

✅ Next.js 14 with App Router
✅ TypeScript
✅ Tailwind CSS
✅ Crimson Pro (serif) and JetBrains Mono fonts
✅ shadcn/ui component library
✅ All core dependencies installed:
  - Clerk (authentication)
  - Supabase (database)
  - Inngest (background jobs)
  - TanStack Query (data fetching)
  - Papa Parse (CSV parsing)
  - fit-file-parser (FIT files)
  - Recharts & Plotly.js (visualization)
  - And more...

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
- Check Node version compatibility

### Fonts Not Loading
- Fonts are loaded via Google Fonts in `layout.tsx`
- They should work automatically on Vercel

### Environment Variables
- Not needed for the landing page POC
- Add them in Vercel dashboard when implementing features
- Never commit actual secrets to git

## Next Steps

Once deployed:
1. ✅ Verify the landing page loads correctly
2. Add authentication with Clerk
3. Setup Supabase database
4. Implement upload functionality
5. Build out the dashboard

The foundation is ready - you can now deploy and start building features incrementally!

