# Vertex
**Your ride, unencrypted**

![Version](https://img.shields.io/badge/version-0.1.0-blue?style=flat-square)
![Status](https://img.shields.io/badge/status-alpha-orange?style=flat-square)

## Overview

Vertex is a complete IMU cycling data platform consisting of:
- **Custom firmware** for ESP32-based IMU sensors
- **Android companion app** for real-time data recording via BLE
- **Web platform** for analyzing and visualizing riding dynamics

The system enables cyclists to gain detailed insights into their riding dynamics—cornering forces, braking behavior, road surface quality, and pedaling smoothness—by combining high-frequency IMU data with standard cycling computer FIT files.

Vertex delivers sophisticated analytics typically found in professional racing telemetry systems with an accessible, modern interface.

## Monorepo Structure

This repository contains all Vertex components with independent versioning:

```
vertex/
├── packages/              # Shared packages
│   ├── vtx-format/       # VTX binary format specification (v0.1.0)
│   └── vtx-constants/    # Shared format constants (v0.1.0)
├── web/                  # Next.js web platform (v0.1.0)
├── android/vertex/       # React Native Android app (v0.1.0)
├── firmware/             # ESP32 IMU firmware (v0.1.0)
├── docs/                 # Monorepo documentation
├── scripts/              # Build and version scripts
├── sql/                  # Database scripts
└── [monorepo configs]    # lerna.json, package.json, .gitignore
```

See [docs/VERSION_COMPATIBILITY.md](./docs/VERSION_COMPATIBILITY.md) for version compatibility matrix.

## Core Capabilities

**Data Management**
- Upload and store large CSV IMU logs (30-150 MB per ride at 50-100 Hz sampling)
- FIT file integration for GPS, power, heart rate, and cadence data
- Manual ride definition from time-series data or automatic extraction from FIT files
- User authentication with OAuth support (Google, GitHub, Strava)

**Analytics & Visualization**
- Traction circle plots showing lateral vs. longitudinal G-forces
- Lean angle timelines revealing cornering dynamics
- Braking event detection and analysis
- Road surface quality assessment
- Power and heart rate correlation (when FIT data available)
- GPS track and elevation profile visualization

**Dashboard & Insights**
- Timeline view of all uploaded data
- Ride history with key metrics (duration, distance, max lean angle)
- Summary statistics across all rides
- Export functionality for processed data and charts

## Quick Start

### Web Platform Development

```bash
# Install dependencies (all packages)
npm install

# Run web development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the web app.

### Android App Development

```bash
cd android/vertex
npm install
npm run android
```

See [android/README.md](./android/README.md) for detailed setup.

### Firmware Development

See [firmware/README_FIRMWARE.md](./firmware/README_FIRMWARE.md) for Arduino setup and flashing instructions.

## Documentation

- **[docs/VERSIONING_STRATEGY.md](./docs/VERSIONING_STRATEGY.md)** - Complete versioning guide
- **[docs/VERSION_COMPATIBILITY.md](./docs/VERSION_COMPATIBILITY.md)** - Compatibility matrix
- **[docs/IMPLEMENTATION_COMPLETE.md](./docs/IMPLEMENTATION_COMPLETE.md)** - Implementation summary
- **[packages/vtx-format/](./packages/vtx-format/)** - VTX binary format specification
- **[android/README.md](./android/README.md)** - Android app documentation
- **[firmware/README_FIRMWARE.md](./firmware/README_FIRMWARE.md)** - Firmware documentation

## Versioning

This monorepo uses **independent versioning** with Lerna:
- Each component versions independently (v0.1.0, v0.2.0, etc.)
- Git tags are namespaced: `firmware/v0.1.0`, `android/v0.1.0`, `web/v0.1.0`
- See [docs/VERSIONING_STRATEGY.md](./docs/VERSIONING_STRATEGY.md) for details

### Version Components

```bash
# Version specific packages
npm run version:vtx-format
npm run version:android
npm run version:web

# Or use lerna directly
npx lerna version
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

## Technology Stack

**Frontend & Hosting**
- **Next.js 14** with App Router for server-side rendering and API routes
- **Vercel** for zero-config deployment and serverless functions
- **shadcn/ui** components with Tailwind CSS for sophisticated, customizable UI
- **TanStack Query** for intelligent server state management and caching

**Backend Services**
- **Clerk** for authentication and user management
- **Supabase (PostgreSQL)** for time-series data storage with Row Level Security
- **Supabase Storage** or AWS S3 for file storage (presigned uploads)
- **Inngest** for serverless background job processing (parsing, analytics)

**Data Processing**
- **Papa Parse** for streaming CSV processing
- **fit-file-parser** for Garmin FIT file decoding
- **simple-statistics** for statistical calculations
- **fili.js** for digital signal processing and filtering
- **Recharts** and **Plotly.js** for data visualization

## Architecture Highlights

**Efficient Upload Pipeline**: Client-side direct upload to S3 using presigned URLs bypasses server bottlenecks and minimizes latency.

**Event-Driven Processing**: Background jobs triggered by upload events handle parsing, analysis, and database population without blocking the UI.

**Time-Series Optimization**: PostgreSQL schema designed for efficient querying of millions of data points per ride, with proper indexing on ride_id and timestamp.

**User Isolation**: Row Level Security ensures each user can only access their own data, with authentication webhooks synchronizing user state.

## Design Philosophy

Vertex distinguishes itself through a **subtle editorial aesthetic** inspired by modern digital products like CoStar and Vacation. 

**Typography**: Serif fonts throughout (Tiempos, Lyon, or Crimson Pro) create a refined, magazine-like quality that stands apart from typical fitness apps. Monospace fonts exclusively for numerical data maintain precision.

**Visual Approach**: "Financial analytics meets cycling" rather than "fitness app" - muted, sophisticated palette avoiding cycling clichés, generous whitespace, and data-forward presentation.

**Functionality**: Animations and interactions are purposeful, never gratuitous. The interface recedes, letting insights take center stage.

## Future Possibilities

- Real-time processing during upload (streaming)
- Machine learning for ride classification and anomaly detection
- Multi-bike comparison and analytics
- Social features: sharing, leaderboards, comparisons
- Native mobile app for easier data upload
- Advanced caching strategies for chart pre-generation

---

**Status**: In development. Vertex is currently in the planning and early implementation phase.

**Live Site**: [ridevertex.com](https://ridevertex.com) (coming soon)
