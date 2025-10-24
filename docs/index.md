---
layout: default
title: Vertex Documentation
description: Complete technical documentation for the Vertex IMU cycling data analysis platform
---

# Vertex Documentation

Welcome to the comprehensive technical documentation for **Vertex**, an IMU cycling data analysis platform that enables detailed insights into riding dynamics through high-frequency sensor data processing.

## 🚀 Quick Navigation

### [Architecture Overview]({{ site.baseurl }}/architecture/)
- [System Design]({{ site.baseurl }}/architecture/system-design.html)
- [Database Schema]({{ site.baseurl }}/architecture/database.html)

### [Development Guide]({{ site.baseurl }}/development/)
- [Build Process]({{ site.baseurl }}/development/BUILD.html)
- [Deployment]({{ site.baseurl }}/development/DEPLOYMENT.html)
- [Local Development Limitations]({{ site.baseurl }}/development/LOCAL_DEV_LIMITATIONS.html)
- [Phase 1 Deployment Guide]({{ site.baseurl }}/development/PHASE1_DEPLOYMENT_GUIDE.html)

### [Feature Documentation]({{ site.baseurl }}/features/)
- [Charting System]({{ site.baseurl }}/features/CHARTING_IMPLEMENTATION.html)
- [Progress Tracking]({{ site.baseurl }}/features/PROGRESS_TRACKING_IMPLEMENTATION.html)
- [Theme System]({{ site.baseurl }}/features/THEME_SYSTEM.html)

### [Operations]({{ site.baseurl }}/operations/)
- [Observability Pipeline]({{ site.baseurl }}/operations/OBSERVABILITY_PIPELINE.html)
- [Storage Cleanup]({{ site.baseurl }}/operations/STORAGE_CLEANUP.html)
- [Project Save State]({{ site.baseurl }}/operations/SAVE_STATE.html)

### [API Reference]({{ site.baseurl }}/api-reference/)
- [Data Upload]({{ site.baseurl }}/api-reference/upload.html)

---

## ⚠️ Local Development Note

**Local Jekyll serving is currently not working** due to Ruby version compatibility issues (requires Ruby 2.7+, system has 2.6). The documentation is fully functional on GitHub Pages at the live URL above.

---

## 📋 Project Status

### ✅ Completed Features
- **High-Performance Charting**: uPlot with LTTB downsampling (60x smaller bundle, 100x faster rendering)
- **Chunked Upload System**: Handles large IMU files (30-150MB) with progress tracking
- **Real-time Processing**: Inngest-based background processing pipeline
- **User Authentication**: Supabase Auth with Google OAuth
- **Data Visualization**: Interactive charts with zoom/pan capabilities
- **Storage Management**: Automated cleanup and orphaned data handling

### 🚧 In Progress
- **Advanced Analytics**: Cornering force analysis, road surface quality metrics
- **FIT File Integration**: GPS track overlay and power data correlation
- **Mobile Optimization**: Touch-friendly chart interactions

### 📋 Planned
- **Team Collaboration**: Multi-user ride sharing and analysis
- **Export Features**: PDF reports and data export capabilities
- **Hardware Integration**: Direct device pairing and data sync

---

## 🎯 Key Capabilities

### Data Processing
- **High-frequency IMU data** (50-100Hz) from custom cycling hardware
- **Multi-axis analysis**: Acceleration, rotation, orientation
- **Real-time visualization** with progressive detail loading
- **Intelligent downsampling** for performance optimization

### Analysis Features
- **Cornering Forces**: Lateral G-force analysis for technique improvement
- **Road Surface Quality**: Vertical G-force patterns for comfort analysis
- **Braking Behavior**: Longitudinal G-force analysis for technique refinement
- **Pedaling Smoothness**: Power delivery analysis and efficiency metrics

### Technical Stack
- **Frontend**: Next.js 14, TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL, Auth, Storage)
- **Processing**: Inngest for background jobs
- **Charts**: uPlot with custom LTTB downsampling
- **Deployment**: Vercel with private GitHub Pages docs

---

## 🔍 For AI Assistants

This documentation is structured for efficient AI reference:

- **Direct file access**: Each topic has its own focused file
- **Semantic organization**: Related topics grouped logically
- **Cross-references**: Links between related concepts
- **Code examples**: Practical implementation details
- **Status tracking**: Clear completion status for features

### Quick Lookup Guide
- **Architecture questions** → `/architecture/` section
- **Development issues** → `/development/` section  
- **Feature implementation** → `/features/` section
- **Deployment problems** → `/operations/` section
- **API usage** → `/api-reference/` section

---

*Last updated: December 2024*
