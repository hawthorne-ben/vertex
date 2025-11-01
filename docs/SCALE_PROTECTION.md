# Scale Protection & Cost Management

## Overview
Strategies to prevent unexpected costs if Vertex goes viral or experiences traffic spikes.

## Immediate Actions (Set These Up Now)

### 1. Vercel Spending Cap
- **Location**: Vercel Dashboard → Settings → Billing → Spending Limit
- **Recommended**: Set to $100-500/month (whatever you're comfortable with)
- **Effect**: Functions stop executing once limit hit (better than surprise bill)
- **Trade-off**: Site goes down temporarily, but prevents financial disaster

### 2. Vercel Usage Alerts
- **Location**: Vercel Dashboard → Settings → Usage & Billing → Notifications
- **Set alerts at**: 50%, 75%, 90% of limits
- **Monitor**: Build minutes, bandwidth, function execution time
- **Action**: Check dashboard daily during any promotion or launch

## Architecture-Level Protection

### 3. Supabase as Primary Storage (Already Implemented ✅)
- **Current**: VTX files served from Supabase Storage, not Vercel
- **Cost**: Supabase Pro is $25/month with 250GB bandwidth included
- **Benefit**: Much cheaper than Vercel bandwidth overages
- **Keep doing**: Store all large files (VTX, FIT) in Supabase

### 4. Server-Side Rendering (Already Implemented ✅)
- **Current**: Using Next.js App Router with SSR
- **Benefit**: Fewer API calls = lower costs than client-side fetching
- **Keep doing**: Fetch data server-side when possible

## Future Improvements (When You Have Users)

### 5. Cloudflare in Front
- **Cost**: Free tier
- **Benefits**:
  - Caching reduces Vercel requests
  - DDoS protection
  - Bot detection
  - Absorbs traffic spikes
- **Setup**: Point DNS to Cloudflare, proxy through to Vercel
- **When**: Before any major launch or advertising

### 6. Rate Limiting
- **Options**:
  - Vercel Edge Middleware (free, built-in)
  - Upstash Redis (pay-per-request)
  - Cloudflare Rate Limiting (free tier: 10k requests/month)
- **Recommended limits**:
  - 100 uploads per user per day
  - 1000 API requests per user per hour
  - 10 requests per second per IP for public endpoints
- **Priority endpoints to protect**:
  - `/api/upload/recording` (expensive, file processing)
  - `/api/recordings/[id]/samples` (high bandwidth)
- **When**: Once you have >100 daily active users

### 7. Maintenance Mode "Kill Switch"
- **Setup**: Create `maintenance.html` in `public/`
- **Deploy**: Use Vercel CLI to quickly deploy maintenance page
- **When**: If costs spike unexpectedly, take site offline for 1 hour while investigating
- **Better**: Temporary downtime vs. thousands in unexpected bills

## Cost Monitoring Checklist

### Daily (During Launch/Promotion)
- [ ] Check Vercel usage dashboard
- [ ] Check Supabase bandwidth usage
- [ ] Review error logs for abuse patterns
- [ ] Check for unusual traffic sources

### Weekly (Normal Operations)
- [ ] Review Vercel bill estimate
- [ ] Check Supabase usage trends
- [ ] Review top API endpoints by traffic

### Monthly
- [ ] Analyze cost per user
- [ ] Review and adjust spending caps
- [ ] Check for optimization opportunities

## Cost Breakdown (Current Setup)

### Vercel Pro: $20/month
- 400 hours build minutes
- 1000 GB-hours serverless execution
- 1 TB bandwidth
- **Risk**: Bandwidth overages ($40/100GB)

### Supabase Pro: $25/month
- 250GB bandwidth included
- 100GB database size
- **Risk**: Bandwidth overages ($10/100GB after included)

### Total Baseline: $45/month

## Red Flags (Investigate Immediately)

- Bandwidth usage >500GB/day (possible attack)
- Single IP making >1000 requests/minute
- Unexpected traffic from single country/region
- Function execution time >1000 GB-hours in a day
- Upload API called >10k times/hour

## Emergency Response Plan

1. **Check Vercel Dashboard** → Usage tab for spike source
2. **If malicious traffic**: Deploy rate limiting immediately
3. **If legitimate viral traffic**:
   - Enable Cloudflare proxy
   - Increase spending cap temporarily
   - Add caching headers to reduce repeated requests
4. **If costs already high**: Deploy maintenance mode, investigate offline
5. **Contact Vercel support**: They can sometimes help with sudden spikes

## Future: When to Upgrade Infrastructure

### Move to Cloudflare Workers + R2 (When cost >$500/month)
- Cloudflare Workers: $5/month for 10M requests
- R2 Storage: $0.015/GB (no egress fees)
- Trade-off: More complex setup, but massive cost savings at scale

### Add Redis Caching (When >10k DAU)
- Upstash Redis: Pay per request
- Cache frequently accessed data
- Reduce database and API load

## Resources

- Vercel Pricing: https://vercel.com/pricing
- Supabase Pricing: https://supabase.com/pricing
- Cloudflare Free Plan: https://www.cloudflare.com/plans/
- Upstash Redis: https://upstash.com/

## Notes

- Current setup is cost-efficient for 0-1000 users
- Most "viral bill" stories are from unprotected APIs or no spending caps
- We already use best practices (Supabase storage, SSR)
- Main risk: Upload endpoint abuse (mitigate with rate limiting)
