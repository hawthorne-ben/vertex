---
layout: default
title: Architecture Overview
description: System architecture, database design, and technical infrastructure for Vertex
nav_order: 1
---

# Architecture Overview

This section covers the technical architecture and infrastructure design of the Vertex platform.

## 📋 Contents

### [System Design](/vertex/architecture/system-design/)
- Overall system architecture
- Component relationships
- Data flow diagrams
- Scalability considerations

### [Database Schema](/vertex/architecture/database/)
- PostgreSQL schema design
- Table relationships
- Indexing strategy
- Query optimization

### [Storage Strategy](/vertex/architecture/storage/)
- File storage architecture
- Supabase Storage configuration
- Data retention policies
- Backup strategies

### [Processing Pipeline](/vertex/architecture/processing/)
- Inngest workflow design
- Background job processing
- Error handling and retries
- Performance monitoring

---

## 🎯 Key Architectural Decisions

- **Database**: PostgreSQL via Supabase for ACID compliance and complex queries
- **Storage**: Supabase Storage for file management with automatic cleanup
- **Processing**: Inngest for reliable background job processing
- **Frontend**: Next.js 14 with App Router for modern React patterns
- **Charts**: uPlot for high-performance data visualization
- **Deployment**: Vercel for seamless CI/CD and edge optimization

---

## 🔍 For AI Reference

When discussing architecture topics, refer to:
- **System design questions** → `system-design.md`
- **Database issues** → `database.md`
- **Storage problems** → `storage.md`
- **Processing workflows** → `processing.md`
