# Time-Based IMU-FIT Association Implementation Plan

## Overview

This document outlines the detailed implementation plan for associating IMU sensor data with Coros FIT file data using time-based synchronization.

## Implementation Architecture

### Core Components

#### 1. Association Engine (`src/lib/association/`)
- **TimeOverlapCalculator**: Calculate overlapping time windows
- **AssociationConfidenceScorer**: Score association quality
- **DataFilter**: Filter data to overlap windows
- **AssociationValidator**: Validate association results

#### 2. Database Layer (`src/lib/database/`)
- **AssociationRepository**: CRUD operations for associations
- **AssociationQueries**: Complex queries for associated data
- **MigrationScripts**: Database schema updates

#### 3. API Layer (`src/app/api/association/`)
- **AssociationController**: Handle association requests
- **ValidationMiddleware**: Validate association parameters
- **ErrorHandling**: Comprehensive error handling

#### 4. UI Components (`src/components/association/`)
- **AssociationManager**: Manage associations
- **AssociationStatus**: Display association status
- **AssociationSettings**: Configure association parameters

## Detailed Implementation Steps

### Step 1: Database Schema Updates

#### File: `sql/association-schema.sql`

```sql
-- Add association tracking to IMU data files
ALTER TABLE imu_data_files ADD COLUMN IF NOT EXISTS associated_fit_file_id UUID REFERENCES fit_files(id);
ALTER TABLE imu_data_files ADD COLUMN IF NOT EXISTS association_method TEXT CHECK (association_method IN ('time', 'gps', 'pattern'));
ALTER TABLE imu_data_files ADD COLUMN IF NOT EXISTS association_confidence REAL CHECK (association_confidence >= 0.0 AND association_confidence <= 1.0);
ALTER TABLE imu_data_files ADD COLUMN IF NOT EXISTS association_overlap_start TIMESTAMPTZ;
ALTER TABLE imu_data_files ADD COLUMN IF NOT EXISTS association_overlap_end TIMESTAMPTZ;
ALTER TABLE imu_data_files ADD COLUMN IF NOT EXISTS association_overlap_duration_minutes INTEGER;
ALTER TABLE imu_data_files ADD COLUMN IF NOT EXISTS association_created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE imu_data_files ADD COLUMN IF NOT EXISTS association_updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add association tracking to FIT files
ALTER TABLE fit_files ADD COLUMN IF NOT EXISTS associated_imu_file_id UUID REFERENCES imu_data_files(id);
ALTER TABLE fit_files ADD COLUMN IF NOT EXISTS association_method TEXT CHECK (association_method IN ('time', 'gps', 'pattern'));
ALTER TABLE fit_files ADD COLUMN IF NOT EXISTS association_confidence REAL CHECK (association_confidence >= 0.0 AND association_confidence <= 1.0);
ALTER TABLE fit_files ADD COLUMN IF NOT EXISTS association_overlap_start TIMESTAMPTZ;
ALTER TABLE fit_files ADD COLUMN IF NOT EXISTS association_overlap_end TIMESTAMPTZ;
ALTER TABLE fit_files ADD COLUMN IF NOT EXISTS association_overlap_duration_minutes INTEGER;
ALTER TABLE fit_files ADD COLUMN IF NOT EXISTS association_created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE fit_files ADD COLUMN IF NOT EXISTS association_updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create indexes for efficient association queries
CREATE INDEX IF NOT EXISTS idx_imu_data_files_associated_fit_file_id ON imu_data_files(associated_fit_file_id);
CREATE INDEX IF NOT EXISTS idx_imu_data_files_association_confidence ON imu_data_files(association_confidence);
CREATE INDEX IF NOT EXISTS idx_imu_data_files_association_overlap_start ON imu_data_files(association_overlap_start);
CREATE INDEX IF NOT EXISTS idx_imu_data_files_association_overlap_end ON imu_data_files(association_overlap_end);

CREATE INDEX IF NOT EXISTS idx_fit_files_associated_imu_file_id ON fit_files(associated_imu_file_id);
CREATE INDEX IF NOT EXISTS idx_fit_files_association_confidence ON fit_files(association_confidence);
CREATE INDEX IF NOT EXISTS idx_fit_files_association_overlap_start ON fit_files(association_overlap_start);
CREATE INDEX IF NOT EXISTS idx_fit_files_association_overlap_end ON fit_files(association_overlap_end);

-- Create association history table for audit trail
CREATE TABLE IF NOT EXISTS association_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imu_file_id UUID REFERENCES imu_data_files(id) ON DELETE CASCADE,
  fit_file_id UUID REFERENCES fit_files(id) ON DELETE CASCADE,
  association_method TEXT NOT NULL,
  association_confidence REAL NOT NULL,
  overlap_start TIMESTAMPTZ NOT NULL,
  overlap_end TIMESTAMPTZ NOT NULL,
  overlap_duration_minutes INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  notes TEXT
);

-- Add RLS policies for association history
ALTER TABLE association_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own association history" ON association_history
  FOR SELECT USING (
    imu_file_id IN (
      SELECT id FROM imu_data_files WHERE user_id = auth.uid()
    ) OR
    fit_file_id IN (
      SELECT id FROM fit_files WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create association history for their files" ON association_history
  FOR INSERT WITH CHECK (
    imu_file_id IN (
      SELECT id FROM imu_data_files WHERE user_id = auth.uid()
    ) OR
    fit_file_id IN (
      SELECT id FROM fit_files WHERE user_id = auth.uid()
    )
  );
```

### Step 2: Core Association Engine

#### File: `src/lib/association/types.ts`

```typescript
export interface TimeRange {
  start: Date
  end: Date
  duration: number // milliseconds
}

export interface AssociationOverlap {
  start: Date
  end: Date
  duration: number // milliseconds
  imuCoverage: number // percentage of IMU data in overlap
  fitCoverage: number // percentage of FIT data in overlap
}

export interface AssociationResult {
  success: boolean
  confidence: number // 0.0 to 1.0
  overlap: AssociationOverlap
  method: 'time' | 'gps' | 'pattern'
  errors?: string[]
  warnings?: string[]
}

export interface AssociationConfig {
  minOverlapMinutes: number // minimum overlap required
  maxTimeDriftMinutes: number // maximum acceptable time drift
  confidenceThreshold: number // minimum confidence for auto-association
  enableGPSValidation: boolean
  enablePatternMatching: boolean
}
```

#### File: `src/lib/association/time-overlap-calculator.ts`

```typescript
import { TimeRange, AssociationOverlap } from './types'

export class TimeOverlapCalculator {
  /**
   * Calculate overlapping time window between IMU and FIT data
   */
  static calculateOverlap(
    imuTimeRange: TimeRange,
    fitTimeRange: TimeRange
  ): AssociationOverlap | null {
    const overlapStart = new Date(Math.max(
      imuTimeRange.start.getTime(),
      fitTimeRange.start.getTime()
    ))
    
    const overlapEnd = new Date(Math.min(
      imuTimeRange.end.getTime(),
      fitTimeRange.end.getTime()
    ))
    
    // Check if there's any overlap
    if (overlapStart >= overlapEnd) {
      return null
    }
    
    const overlapDuration = overlapEnd.getTime() - overlapStart.getTime()
    const imuCoverage = overlapDuration / imuTimeRange.duration
    const fitCoverage = overlapDuration / fitTimeRange.duration
    
    return {
      start: overlapStart,
      end: overlapEnd,
      duration: overlapDuration,
      imuCoverage: imuCoverage,
      fitCoverage: fitCoverage
    }
  }
  
  /**
   * Extract time range from IMU data
   */
  static extractImuTimeRange(imuData: any[]): TimeRange {
    if (imuData.length === 0) {
      throw new Error('IMU data is empty')
    }
    
    const timestamps = imuData.map(point => new Date(point.timestamp))
    const start = new Date(Math.min(...timestamps.map(t => t.getTime())))
    const end = new Date(Math.max(...timestamps.map(t => t.getTime())))
    
    return {
      start,
      end,
      duration: end.getTime() - start.getTime()
    }
  }
  
  /**
   * Extract time range from FIT data
   */
  static extractFitTimeRange(fitData: any): TimeRange {
    if (!fitData.sessions || fitData.sessions.length === 0) {
      throw new Error('FIT data has no sessions')
    }
    
    const session = fitData.sessions[0]
    const start = new Date(session.start_time)
    const end = new Date(session.timestamp)
    
    return {
      start,
      end,
      duration: end.getTime() - start.getTime()
    }
  }
}
```

#### File: `src/lib/association/confidence-scorer.ts`

```typescript
import { AssociationOverlap, AssociationResult } from './types'

export class AssociationConfidenceScorer {
  /**
   * Calculate confidence score for time-based association
   */
  static calculateConfidence(
    overlap: AssociationOverlap,
    config: any
  ): number {
    let confidence = 0.0
    
    // Base confidence from overlap coverage
    const avgCoverage = (overlap.imuCoverage + overlap.fitCoverage) / 2
    confidence += avgCoverage * 0.6 // 60% weight for coverage
    
    // Bonus for high overlap duration
    const overlapMinutes = overlap.duration / (1000 * 60)
    if (overlapMinutes >= 60) {
      confidence += 0.2 // 20% bonus for long overlaps
    } else if (overlapMinutes >= 30) {
      confidence += 0.1 // 10% bonus for medium overlaps
    }
    
    // Bonus for balanced coverage
    const coverageBalance = 1 - Math.abs(overlap.imuCoverage - overlap.fitCoverage)
    confidence += coverageBalance * 0.2 // 20% weight for balance
    
    return Math.min(confidence, 1.0)
  }
  
  /**
   * Validate association against configuration
   */
  static validateAssociation(
    overlap: AssociationOverlap,
    config: any
  ): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = []
    const warnings: string[] = []
    
    const overlapMinutes = overlap.duration / (1000 * 60)
    
    // Check minimum overlap
    if (overlapMinutes < config.minOverlapMinutes) {
      errors.push(`Overlap too short: ${overlapMinutes.toFixed(1)} minutes (minimum: ${config.minOverlapMinutes})`)
    }
    
    // Check coverage thresholds
    if (overlap.imuCoverage < 0.5) {
      warnings.push(`Low IMU coverage: ${(overlap.imuCoverage * 100).toFixed(1)}%`)
    }
    
    if (overlap.fitCoverage < 0.5) {
      warnings.push(`Low FIT coverage: ${(overlap.fitCoverage * 100).toFixed(1)}%`)
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    }
  }
}
```

### Step 3: API Endpoints

#### File: `src/app/api/association/associate/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { TimeOverlapCalculator } from '@/lib/association/time-overlap-calculator'
import { AssociationConfidenceScorer } from '@/lib/association/confidence-scorer'

export async function POST(request: NextRequest) {
  try {
    const { imuFileId, fitFileId, config } = await request.json()
    
    if (!imuFileId || !fitFileId) {
      return NextResponse.json(
        { error: 'Missing imuFileId or fitFileId' },
        { status: 400 }
      )
    }
    
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    // Fetch IMU data
    const { data: imuFile, error: imuError } = await supabase
      .from('imu_data_files')
      .select('*')
      .eq('id', imuFileId)
      .eq('user_id', user.id)
      .single()
    
    if (imuError || !imuFile) {
      return NextResponse.json(
        { error: 'IMU file not found' },
        { status: 404 }
      )
    }
    
    // Fetch FIT data
    const { data: fitFile, error: fitError } = await supabase
      .from('fit_files')
      .select('*')
      .eq('id', fitFileId)
      .eq('user_id', user.id)
      .single()
    
    if (fitError || !fitFile) {
      return NextResponse.json(
        { error: 'FIT file not found' },
        { status: 404 }
      )
    }
    
    // Fetch IMU samples for time range calculation
    const { data: imuSamples, error: samplesError } = await supabase
      .from('imu_samples')
      .select('timestamp')
      .eq('data_file_id', imuFileId)
      .order('timestamp')
    
    if (samplesError || !imuSamples || imuSamples.length === 0) {
      return NextResponse.json(
        { error: 'No IMU samples found' },
        { status: 404 }
      )
    }
    
    // Calculate time overlap
    const imuTimeRange = TimeOverlapCalculator.extractImuTimeRange(imuSamples)
    const fitTimeRange = TimeOverlapCalculator.extractFitTimeRange({
      sessions: [{
        start_time: fitFile.start_time,
        timestamp: fitFile.end_time
      }]
    })
    
    const overlap = TimeOverlapCalculator.calculateOverlap(imuTimeRange, fitTimeRange)
    
    if (!overlap) {
      return NextResponse.json(
        { error: 'No time overlap found between files' },
        { status: 400 }
      )
    }
    
    // Calculate confidence score
    const confidence = AssociationConfidenceScorer.calculateConfidence(overlap, config)
    
    // Validate association
    const validation = AssociationConfidenceScorer.validateAssociation(overlap, config)
    
    if (!validation.valid) {
      return NextResponse.json(
        { 
          error: 'Association validation failed',
          details: validation.errors,
          warnings: validation.warnings
        },
        { status: 400 }
      )
    }
    
    // Create association
    const associationData = {
      associated_fit_file_id: fitFileId,
      association_method: 'time',
      association_confidence: confidence,
      association_overlap_start: overlap.start.toISOString(),
      association_overlap_end: overlap.end.toISOString(),
      association_overlap_duration_minutes: Math.round(overlap.duration / (1000 * 60)),
      association_updated_at: new Date().toISOString()
    }
    
    const { error: updateError } = await supabase
      .from('imu_data_files')
      .update(associationData)
      .eq('id', imuFileId)
    
    if (updateError) {
      throw updateError
    }
    
    // Update FIT file with reverse association
    const { error: fitUpdateError } = await supabase
      .from('fit_files')
      .update({
        associated_imu_file_id: imuFileId,
        association_method: 'time',
        association_confidence: confidence,
        association_overlap_start: overlap.start.toISOString(),
        association_overlap_end: overlap.end.toISOString(),
        association_overlap_duration_minutes: Math.round(overlap.duration / (1000 * 60)),
        association_updated_at: new Date().toISOString()
      })
      .eq('id', fitFileId)
    
    if (fitUpdateError) {
      throw fitUpdateError
    }
    
    // Log association in history
    const { error: historyError } = await supabase
      .from('association_history')
      .insert({
        imu_file_id: imuFileId,
        fit_file_id: fitFileId,
        association_method: 'time',
        association_confidence: confidence,
        overlap_start: overlap.start.toISOString(),
        overlap_end: overlap.end.toISOString(),
        overlap_duration_minutes: Math.round(overlap.duration / (1000 * 60)),
        created_by: user.id,
        notes: `Time-based association with ${(confidence * 100).toFixed(1)}% confidence`
      })
    
    if (historyError) {
      console.warn('Failed to log association history:', historyError)
    }
    
    return NextResponse.json({
      success: true,
      association: {
        imuFileId,
        fitFileId,
        confidence,
        overlap: {
          start: overlap.start.toISOString(),
          end: overlap.end.toISOString(),
          durationMinutes: Math.round(overlap.duration / (1000 * 60)),
          imuCoverage: overlap.imuCoverage,
          fitCoverage: overlap.fitCoverage
        },
        warnings: validation.warnings
      }
    })
    
  } catch (error) {
    console.error('Association error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
```

### Step 4: UI Components

#### File: `src/components/association/association-manager.tsx`

```typescript
"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface AssociationManagerProps {
  imuFileId: string
  fitFileId: string
  onAssociationComplete: (result: any) => void
}

export function AssociationManager({ 
  imuFileId, 
  fitFileId, 
  onAssociationComplete 
}: AssociationManagerProps) {
  const [isAssociating, setIsAssociating] = useState(false)
  const [associationResult, setAssociationResult] = useState<any>(null)
  
  const handleAssociate = async () => {
    setIsAssociating(true)
    
    try {
      const response = await fetch('/api/association/associate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imuFileId,
          fitFileId,
          config: {
            minOverlapMinutes: 30,
            maxTimeDriftMinutes: 5,
            confidenceThreshold: 0.7
          }
        })
      })
      
      const result = await response.json()
      
      if (response.ok) {
        setAssociationResult(result.association)
        onAssociationComplete(result.association)
      } else {
        console.error('Association failed:', result.error)
      }
    } catch (error) {
      console.error('Association error:', error)
    } finally {
      setIsAssociating(false)
    }
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Data Association</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            Associate IMU sensor data with ride data using time-based synchronization.
          </p>
          
          <Button 
            onClick={handleAssociate}
            disabled={isAssociating}
            className="w-full"
          >
            {isAssociating ? 'Associating...' : 'Associate Data'}
          </Button>
          
          {associationResult && (
            <div className="mt-4 p-4 bg-green-50 rounded-lg">
              <h4 className="font-medium text-green-800">Association Successful</h4>
              <div className="mt-2 space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm">Confidence:</span>
                  <Badge variant="secondary">
                    {(associationResult.confidence * 100).toFixed(1)}%
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Overlap Duration:</span>
                  <span className="text-sm font-medium">
                    {associationResult.overlap.durationMinutes} minutes
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">IMU Coverage:</span>
                  <span className="text-sm font-medium">
                    {(associationResult.overlap.imuCoverage * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">FIT Coverage:</span>
                  <span className="text-sm font-medium">
                    {(associationResult.overlap.fitCoverage * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
```

## Testing Strategy

### Unit Tests
- Time overlap calculation accuracy
- Confidence scoring algorithms
- Data filtering functions

### Integration Tests
- API endpoint functionality
- Database operations
- Error handling scenarios

### End-to-End Tests
- Complete association workflow
- UI interaction flows
- Performance benchmarks

## Performance Considerations

### Database Optimization
- Indexed queries for time ranges
- Efficient data filtering
- Minimal data transfer

### Caching Strategy
- Cache association results
- Invalidate on data updates
- Background pre-calculation

### Scalability
- Batch processing for multiple associations
- Background job processing
- Rate limiting for API endpoints

## Monitoring & Observability

### Metrics
- Association success rate
- Average confidence scores
- Processing time per association
- Error rates by type

### Logging
- Detailed association logs
- Performance metrics
- Error tracking and debugging

### Alerts
- Low confidence associations
- Failed associations
- Performance degradation
