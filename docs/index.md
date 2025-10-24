---
layout: default
title: Vertex Documentation
description: Complete technical documentation for the Vertex IMU cycling data analysis platform
---

# Vertex Documentation

Welcome to the comprehensive technical documentation for **Vertex**, an IMU cycling data analysis platform that enables detailed insights into riding dynamics through high-frequency sensor data processing.

## 🚀 Quick Navigation

### [Architecture Overview]({{ site.baseurl }}/architecture/)
- [System Design]({{ site.baseurl }}/architecture/system-design/)
- [Database Schema]({{ site.baseurl }}/architecture/database/)
- [Storage Strategy]({{ site.baseurl }}/architecture/storage/)
- [Processing Pipeline]({{ site.baseurl }}/architecture/processing/)

### [Development Guide]({{ site.baseurl }}/development/)
- [Local Setup]({{ site.baseurl }}/development/local-setup/)
- [Deployment]({{ site.baseurl }}/development/deployment/)
- [Debugging]({{ site.baseurl }}/development/debugging/)
- [Build Process]({{ site.baseurl }}/development/build/)

### [Feature Documentation]({{ site.baseurl }}/features/)
- [Charting System]({{ site.baseurl }}/features/charting/)
- [Upload System]({{ site.baseurl }}/features/upload/)
- [Data Analysis]({{ site.baseurl }}/features/analysis/)
- [Progress Tracking]({{ site.baseurl }}/features/progress/)

### [Operations]({{ site.baseurl }}/operations/)
- [Monitoring]({{ site.baseurl }}/operations/monitoring/)
- [Storage Cleanup]({{ site.baseurl }}/operations/cleanup/)
- [Troubleshooting]({{ site.baseurl }}/operations/troubleshooting/)

### [API Reference]({{ site.baseurl }}/api-reference/)
- [Authentication]({{ site.baseurl }}/api-reference/auth/)
- [Data Upload]({{ site.baseurl }}/api-reference/upload/)
- [Admin Endpoints]({{ site.baseurl }}/api-reference/admin/)
- [Health Checks]({{ site.baseurl }}/api-reference/health/)

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
