# Coros FIT File Analysis & IMU Association Strategy

## Overview

This document analyzes the data available in Coros FIT file exports and outlines strategies for associating IMU sensor data with ride data to enable advanced analytics and visualization features.

## Coros FIT File Data Structure

### Available Data ✅

#### Session-Level Summary Data
- **Duration**: Total elapsed time (264.4 minutes in sample)
- **Distance**: Total distance covered (45.54 km in sample)
- **Timestamps**: Start and end times with high precision
- **Calories**: Total calories burned
- **Power Metrics**: Max power (1222W), average power (153W), normalized power (212W)
- **Heart Rate**: Max (186 bpm), min (85 bpm), average (136 bpm)
- **Cadence**: Max (122 rpm), average (65 rpm)
- **Speed**: Max (60.8 km/h), average (21.3 km/h)
- **Temperature**: Average temperature (17°C)
- **Work**: Total work performed (1,180,000 J)

#### High-Resolution GPS Track Data
- **GPS Points**: 7,560 points over 264 minutes
- **Resolution**: 2.1 seconds per point (28.6 points/minute)
- **Coverage**: 99.4%+ data availability for all metrics
- **Coordinates**: Latitude/longitude with high precision
- **Speed**: Instantaneous speed at each point
- **Power**: Power output at each GPS point (99.4% coverage)
- **Heart Rate**: HR at each GPS point (100% coverage)
- **Cadence**: Cadence at each GPS point (99.9% coverage)

#### Device Information
- **Manufacturer**: Coros
- **Device Model**: COROS DURA
- **Sport Type**: Cycling (road)

### Missing/Limited Data ❌

#### Elevation Data
- **Issue**: Altitude readings are inaccurate (0.26m span vs expected SF hills)
- **Cause**: Device lacks barometric altimeter or GPS altitude is unreliable
- **Impact**: Cannot calculate accurate elevation gain from device data
- **Workaround**: External elevation lookup services (like Strava uses)

#### Advanced Metrics
- **No**: Gradient/slope data
- **No**: Wind data
- **No**: Temperature variations (only average)
- **No**: Detailed lap splits (only session-level)

## IMU Data Association Strategy

### Primary Method: Time-Based Synchronization

#### Concept
Associate IMU sensor data with ride data by matching timestamps within overlapping time windows.

#### Advantages
- **Reliable**: Works regardless of GPS accuracy
- **Simple**: Straightforward implementation
- **Robust**: Handles device clock differences
- **Scalable**: Works with any IMU sampling rate

#### Implementation Approach

```typescript
interface TimeBasedAssociation {
  rideTimeRange: {
    start: Date
    end: Date
  }
  imuTimeRange: {
    start: Date
    end: Date
  }
  overlapWindow: {
    start: Date
    end: Date
    duration: number // minutes
  }
  associationConfidence: number // 0.0 to 1.0
}
```

#### Association Process

1. **Extract Time Ranges**
   - Ride: `sessions[0].start_time` to `sessions[0].timestamp`
   - IMU: First to last timestamp in dataset

2. **Find Overlap Window**
   - Start: `max(rideStart, imuStart)`
   - End: `min(rideEnd, imuEnd)`
   - Duration: `overlapEnd - overlapStart`

3. **Calculate Confidence Score**
   - Overlap percentage: `overlapDuration / min(rideDuration, imuDuration)`
   - Data quality: GPS point density, IMU sampling rate
   - Time alignment: Clock synchronization accuracy

4. **Filter Data to Overlap Window**
   - Ride GPS points within overlap window
   - IMU samples within overlap window

### Secondary Method: GPS Coordinate Validation

#### Concept
Validate time-based associations using GPS proximity matching.

#### Implementation
- Find IMU data points near ride GPS coordinates
- Use 50-meter radius for proximity matching
- Flag discrepancies for manual review

### Tertiary Method: Pattern Matching

#### Concept
Match acceleration patterns between IMU and ride data for validation.

#### Implementation
- Compare IMU acceleration with ride speed changes
- Correlate power output with IMU movement patterns
- Use machine learning for pattern recognition

## Feature Implementation Plan

### Phase 1: Time-Based Association (Priority 1)

#### Database Schema Updates
```sql
-- Add association tracking to IMU data files
ALTER TABLE imu_data_files ADD COLUMN associated_fit_file_id UUID REFERENCES fit_files(id);
ALTER TABLE imu_data_files ADD COLUMN association_method TEXT CHECK (association_method IN ('time', 'gps', 'pattern'));
ALTER TABLE imu_data_files ADD COLUMN association_confidence REAL CHECK (association_confidence >= 0.0 AND association_confidence <= 1.0);
ALTER TABLE imu_data_files ADD COLUMN association_overlap_start TIMESTAMPTZ;
ALTER TABLE imu_data_files ADD COLUMN association_overlap_end TIMESTAMPTZ;
ALTER TABLE imu_data_files ADD COLUMN association_overlap_duration_minutes INTEGER;

-- Add indexes for efficient association queries
CREATE INDEX IF NOT EXISTS idx_imu_data_files_associated_fit_file_id ON imu_data_files(associated_fit_file_id);
CREATE INDEX IF NOT EXISTS idx_imu_data_files_association_confidence ON imu_data_files(association_confidence);
```

#### API Endpoints
- `POST /api/associate/imu-to-fit` - Associate IMU data with FIT file
- `GET /api/associate/status/{fileId}` - Check association status
- `DELETE /api/associate/{associationId}` - Remove association

#### Core Functions
- `findTimeOverlap(imuData, fitData)` - Calculate overlap window
- `calculateAssociationConfidence(overlap)` - Score association quality
- `filterDataToOverlap(data, overlapWindow)` - Extract relevant data

### Phase 2: GPS Validation (Priority 2)

#### Features
- GPS proximity validation
- Discrepancy flagging
- Manual review interface

### Phase 3: Pattern Matching (Priority 3)

#### Features
- Acceleration pattern correlation
- Power-movement relationship analysis
- Machine learning validation

## Data Quality Considerations

### Clock Synchronization
- **Issue**: Device clocks may drift or be set incorrectly
- **Solution**: Allow manual time offset adjustment
- **Tolerance**: ±5 minutes automatic, manual adjustment beyond

### Sampling Rate Mismatch
- **FIT GPS**: 2.1 seconds per point
- **IMU**: Variable (typically 10-100 Hz)
- **Solution**: Interpolate IMU data to FIT timestamps

### Data Gaps
- **GPS**: Occasional missing points (0.6% in sample)
- **IMU**: Potential sensor dropouts
- **Solution**: Gap detection and interpolation

## Implementation Timeline

### Week 1: Database Schema & Core Functions
- Update database schema
- Implement time overlap calculation
- Create association confidence scoring

### Week 2: API Endpoints & UI
- Build association API endpoints
- Create association management UI
- Implement data filtering functions

### Week 3: Testing & Validation
- Test with sample data
- Validate association accuracy
- Performance optimization

### Week 4: Advanced Features
- GPS validation implementation
- Pattern matching foundation
- Error handling and edge cases

## Success Metrics

### Association Quality
- **Target**: >95% successful associations
- **Confidence**: >0.8 average confidence score
- **Overlap**: >80% time overlap for valid associations

### Performance
- **Association Time**: <5 seconds for typical datasets
- **Query Performance**: <100ms for associated data retrieval
- **Storage Efficiency**: Minimal overhead for association metadata

## Future Enhancements

### Elevation Correction
- Integrate external elevation services
- Correct device elevation data using GPS coordinates
- Provide accurate elevation gain calculations

### Advanced Analytics
- Power-efficiency analysis using IMU data
- Movement pattern recognition
- Performance trend analysis

### Multi-Device Support
- Support for different GPS device manufacturers
- Handle varying GPS resolutions and data formats
- Standardize data across device types
