---
layout: default
title: Development Guide
description: Local development setup, deployment procedures, and debugging guides
nav_order: 2
---

# Development Guide

Complete guide for setting up, developing, and deploying the Vertex platform.

## 📋 Contents

### [Build Process]({{ site.baseurl }}/development/BUILD.html)
- Build configuration
- Optimization settings
- Bundle analysis
- Performance monitoring

### [Deployment]({{ site.baseurl }}/development/DEPLOYMENT.html)
- Production deployment procedures
- Vercel configuration
- Environment variables
- CI/CD pipeline

### [Local Development Limitations]({{ site.baseurl }}/development/LOCAL_DEV_LIMITATIONS.html)
- Known limitations and workarounds
- Development environment constraints
- Testing considerations

### [Phase 1 Deployment Guide]({{ site.baseurl }}/development/PHASE1_DEPLOYMENT_GUIDE.html)
- Step-by-step deployment instructions
- Configuration requirements
- Troubleshooting common issues

---

## 🚀 Quick Start

1. **Clone and Install**
   ```bash
   git clone <repo-url>
   cd vertex
   npm install
   ```

2. **Environment Setup**
   ```bash
   cp env.local.dev.template .env.local
   # Configure your environment variables
   ```

3. **Start Development**
   ```bash
   npm run dev
   npx inngest-cli@latest dev
   ```

---

## 🔍 For AI Reference

When discussing development topics, refer to:
- **Build issues** → `BUILD.md`
- **Deployment problems** → `DEPLOYMENT.md`
- **Local limitations** → `LOCAL_DEV_LIMITATIONS.md`
- **Phase 1 deployment** → `PHASE1_DEPLOYMENT_GUIDE.md`
