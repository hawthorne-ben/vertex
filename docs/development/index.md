---
layout: default
title: Development Guide
description: Local development setup, deployment procedures, and debugging guides
nav_order: 2
---

# Development Guide

Complete guide for setting up, developing, and deploying the Vertex platform.

## 📋 Contents

### [Local Setup](/vertex/development/local-setup/)
- Environment configuration
- Database setup
- Development dependencies
- First-time setup walkthrough

### [Deployment](/vertex/development/deployment/)
- Production deployment procedures
- Vercel configuration
- Environment variables
- CI/CD pipeline

### [Debugging](/vertex/development/debugging/)
- Common debugging scenarios
- Log analysis
- Performance troubleshooting
- Error resolution

### [Build Process](/vertex/development/build/)
- Build configuration
- Optimization settings
- Bundle analysis
- Performance monitoring

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
- **Setup issues** → `local-setup.md`
- **Deployment problems** → `deployment.md`
- **Debugging scenarios** → `debugging.md`
- **Build issues** → `build.md`
