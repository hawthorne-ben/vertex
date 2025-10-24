---
layout: default
title: Database Schema
description: PostgreSQL database design and schema for Vertex platform
---

# Database Schema

## Overview

The Vertex platform uses PostgreSQL via Supabase for data storage, optimized for time-series IMU data with user isolation and efficient querying.

---

## Core Tables

### Users Table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Data Files Table
```sql
CREATE TABLE data_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  file_type TEXT NOT NULL, -- 'imu_csv' or 'fit_file'
  upload_status TEXT DEFAULT 'uploading', -- 'uploading', 'processing', 'completed', 'failed'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### IMU Samples Table
```sql
CREATE TABLE imu_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_file_id UUID REFERENCES data_files(id) ON DELETE CASCADE,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  accel_x REAL NOT NULL,
  accel_y REAL NOT NULL,
  accel_z REAL NOT NULL,
  gyro_x REAL NOT NULL,
  gyro_y REAL NOT NULL,
  gyro_z REAL NOT NULL,
  mag_x REAL,
  mag_y REAL,
  mag_z REAL,
  temperature REAL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Rides Table
```sql
CREATE TABLE rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_seconds INTEGER NOT NULL,
  distance_meters REAL,
  elevation_gain_meters REAL,
  bike_type TEXT,
  conditions TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Ride Data Files Association
```sql
CREATE TABLE ride_data_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID REFERENCES rides(id) ON DELETE CASCADE,
  data_file_id UUID REFERENCES data_files(id) ON DELETE CASCADE,
  file_type TEXT NOT NULL, -- 'imu_data' or 'fit_data'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## Indexes for Performance

### Time-Series Optimization
```sql
-- Optimize IMU data queries by timestamp
CREATE INDEX idx_imu_samples_timestamp ON imu_samples(timestamp);
CREATE INDEX idx_imu_samples_data_file_timestamp ON imu_samples(data_file_id, timestamp);

-- Optimize ride queries by time range
CREATE INDEX idx_rides_start_time ON rides(start_time);
CREATE INDEX idx_rides_user_start_time ON rides(user_id, start_time);
```

### User Isolation
```sql
-- Ensure efficient user-based queries
CREATE INDEX idx_data_files_user_id ON data_files(user_id);
CREATE INDEX idx_rides_user_id ON rides(user_id);
```

### File Management
```sql
-- Optimize file status queries
CREATE INDEX idx_data_files_status ON data_files(upload_status);
CREATE INDEX idx_data_files_user_status ON data_files(user_id, upload_status);
```

---

## Row Level Security (RLS)

### Enable RLS
```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE imu_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_data_files ENABLE ROW LEVEL SECURITY;
```

### User Isolation Policies
```sql
-- Users can only access their own data
CREATE POLICY "Users can view own profile" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE USING (auth.uid() = id);

-- Data files isolation
CREATE POLICY "Users can view own data files" ON data_files
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own data files" ON data_files
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own data files" ON data_files
  FOR UPDATE USING (auth.uid() = user_id);

-- IMU samples isolation
CREATE POLICY "Users can view own imu samples" ON imu_samples
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM data_files 
      WHERE data_files.id = imu_samples.data_file_id 
      AND data_files.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own imu samples" ON imu_samples
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM data_files 
      WHERE data_files.id = imu_samples.data_file_id 
      AND data_files.user_id = auth.uid()
    )
  );

-- Rides isolation
CREATE POLICY "Users can view own rides" ON rides
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own rides" ON rides
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own rides" ON rides
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own rides" ON rides
  FOR DELETE USING (auth.uid() = user_id);
```

---

## Data Types and Constraints

### IMU Data Specifications
- **Accelerometer**: ±16g range, 0.1mg resolution
- **Gyroscope**: ±2000dps range, 0.1dps resolution
- **Magnetometer**: ±1200μT range, 0.1μT resolution
- **Sampling Rate**: 50-100Hz typical
- **Temperature**: -40°C to +85°C range

### File Size Limits
- **CSV Files**: 30-150MB typical, 500MB maximum
- **FIT Files**: 1-10MB typical, 50MB maximum
- **Chunk Size**: 1MB for upload processing

### Time Precision
- **Timestamps**: Microsecond precision
- **Duration**: Second precision
- **Time Zones**: UTC storage with local display

---

## Query Optimization Strategies

### Pagination for Large Datasets
```sql
-- Efficient pagination for IMU data
SELECT * FROM imu_samples 
WHERE data_file_id = $1 
ORDER BY timestamp 
LIMIT 1000 OFFSET $2;
```

### Time Range Queries
```sql
-- Optimized time range queries
SELECT * FROM imu_samples 
WHERE data_file_id = $1 
AND timestamp BETWEEN $2 AND $3 
ORDER BY timestamp;
```

### Aggregation Queries
```sql
-- Statistical analysis queries
SELECT 
  AVG(accel_x) as avg_accel_x,
  STDDEV(accel_x) as std_accel_x,
  MIN(accel_x) as min_accel_x,
  MAX(accel_x) as max_accel_x
FROM imu_samples 
WHERE data_file_id = $1 
AND timestamp BETWEEN $2 AND $3;
```

---

## Backup and Recovery

### Automated Backups
- **Supabase**: Daily automated backups
- **Retention**: 7 days for free tier, 30 days for pro
- **Point-in-time Recovery**: Available for pro tier

### Data Export
```sql
-- Export user data for backup
SELECT 
  u.*,
  df.filename,
  df.file_size,
  df.file_type,
  df.upload_status,
  COUNT(ims.id) as sample_count
FROM users u
LEFT JOIN data_files df ON u.id = df.user_id
LEFT JOIN imu_samples ims ON df.id = ims.data_file_id
WHERE u.id = $1
GROUP BY u.id, df.id;
```

---

## Related Documentation

- [System Design]({{ site.baseurl }}/architecture/system-design.html) - Overall architecture
- [Development Guide]({{ site.baseurl }}/development/) - Database setup procedures
