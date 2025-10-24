# IMU-FIT Association Implementation Plan

## Overview

This document outlines the complete implementation plan for associating IMU sensor data with FIT file ride data using time-based synchronization. The system will enable advanced analytics by correlating sensor measurements with GPS-tracked cycling activities.

## Implementation Phases

### Phase 1: Build Core Association Engine (Week 1)
**Goal**: Create the foundational logic for calculating time overlaps and confidence scores

#### Step 1: Create Type Definitions
- **File**: `src/lib/association/types.ts`
- **Purpose**: Define TypeScript interfaces for association data structures
- **Key Interfaces**:
  - `TimeRange`: Start/end times with duration
  - `AssociationOverlap`: Overlap window with coverage percentages
  - `AssociationResult`: Complete association result with confidence
  - `AssociationConfig`: Configuration parameters

#### Step 2: Build Time Overlap Calculator
- **File**: `src/lib/association/time-overlap-calculator.ts`
- **Purpose**: Calculate overlapping time windows between datasets
- **Key Functions**:
  - `calculateOverlap()`: Find intersection of time ranges
  - `extractImuTimeRange()`: Extract time bounds from IMU data
  - `extractFitTimeRange()`: Extract time bounds from FIT data
- **Edge Cases**: Handle no overlap, invalid timestamps, empty datasets

#### Step 3: Build Confidence Scorer
- **File**: `src/lib/association/confidence-scorer.ts`
- **Purpose**: Score association quality based on multiple factors
- **Scoring Algorithm**:
  - 60% weight: Average overlap coverage (IMU + FIT coverage)
  - 20% weight: Overlap duration bonus (longer = better)
  - 20% weight: Coverage balance (balanced = better)
- **Validation**: Minimum overlap thresholds, data quality checks

#### Step 4: Test Core Functions
- **File**: `scripts/test-association-engine.js`
- **Purpose**: Validate core functions with sample data
- **Tests**: Overlap calculations, confidence scoring, edge cases

### Phase 2: API Endpoints (Week 2)
**Goal**: Create RESTful APIs for association management

#### Step 5: Create Association API
- **File**: `src/app/api/association/associate/route.ts`
- **Endpoint**: `POST /api/association/associate`
- **Purpose**: Associate IMU and FIT files
- **Input**: `{imuFileId, fitFileId, config}`
- **Output**: Association result with confidence score
- **Features**: Validation, error handling, audit logging

#### Step 6: Create Status & History APIs
- **Files**: 
  - `src/app/api/association/status/[fileId]/route.ts`
  - `src/app/api/association/history/[fileId]/route.ts`
- **Endpoints**: 
  - `GET /api/association/status/{fileId}`
  - `GET /api/association/history/{fileId}`
- **Purpose**: Check association status and view history

#### Step 7: Test API Endpoints
- **Method**: Manual testing with curl/Postman
- **Tests**: Successful associations, error cases, edge conditions

### Phase 3: UI Components (Week 3)
**Goal**: Build user interface for association management

#### Step 8: Build Ride Builder
- **File**: `src/components/ride-builder/ride-builder.tsx`
- **Purpose**: Main interface for creating rides by combining data sources
- **Features**:
  - Data source selection (IMU + FIT files)
  - Automatic ride creation with confidence scoring
  - Manual ride building for edge cases
  - Ride preview and validation

#### Step 9: Build Ride Management Components
- **Files**:
  - `src/components/ride-builder/ride-status.tsx`
  - `src/components/ride-builder/ride-settings.tsx`
- **Purpose**: Display ride status and manage ride settings
- **Features**: Ride status indicators, confidence badges, settings panel

#### Step 10: Integrate with Data Pages
- **Files**: Update existing data list components
- **Integration Points**:
  - Add "Build Ride" buttons to file lists
  - Show ride status in file cards
  - Add ride management to settings
  - Automatic ride creation on FIT upload

### Phase 4: Testing & Optimization (Week 4)
**Goal**: Comprehensive testing and performance optimization

#### Step 11: End-to-End Testing
- **Scope**: Real IMU and FIT files from Coros device
- **Validation**: Association accuracy with known overlapping data
- **Performance**: Large dataset handling, query optimization

#### Step 12: Advanced Features
- **GPS Validation**: Coordinate-based association verification
- **Pattern Matching**: Acceleration pattern correlation
- **Error Handling**: Comprehensive error recovery
- **Manual Override**: User-controlled association management

## Technical Architecture

### Core Components
```
src/lib/association/
├── types.ts                    # Type definitions
├── time-overlap-calculator.ts  # Overlap calculation logic
├── confidence-scorer.ts        # Confidence scoring algorithm
└── data-filter.ts             # Data filtering utilities
```

### API Layer
```
src/app/api/association/
├── associate/route.ts         # Main association endpoint
├── status/[fileId]/route.ts   # Status checking
└── history/[fileId]/route.ts  # History retrieval
```

### UI Components
```
src/components/association/
├── association-manager.tsx    # Main association interface
├── association-status.tsx     # Status display
└── association-settings.tsx    # Configuration panel
```

## Database Schema

### Association Tracking
- **IMU Files**: `associated_fit_file_id`, `association_method`, `association_confidence`
- **FIT Files**: `associated_imu_file_id`, `association_method`, `association_confidence`
- **History**: Complete audit trail in `association_history` table

### Indexes
- Association foreign keys for efficient joins
- Confidence scores for filtering
- Overlap timestamps for time-based queries

## Success Metrics

### Association Quality
- **Target**: >95% successful associations
- **Confidence**: >0.8 average confidence score
- **Overlap**: >80% time overlap for valid associations

### Performance
- **Association Time**: <5 seconds for typical datasets
- **Query Performance**: <100ms for associated data retrieval
- **Storage Efficiency**: Minimal overhead for association metadata

## Risk Mitigation

### Data Quality Issues
- **Clock Drift**: Allow manual time offset adjustment
- **Sampling Mismatch**: Interpolate IMU data to FIT timestamps
- **Data Gaps**: Gap detection and interpolation

### Edge Cases
- **No Overlap**: Clear error messages and suggestions
- **Low Confidence**: Warning indicators and manual review options
- **Multiple Associations**: Conflict resolution and user choice

## Future Enhancements

### Advanced Features
- **Elevation Correction**: External elevation service integration
- **Multi-Device Support**: Different GPS device manufacturers
- **Machine Learning**: Pattern recognition for validation
- **Real-time Processing**: Live association during data collection

### Analytics Integration
- **Power Efficiency**: IMU-based power analysis
- **Movement Patterns**: Cycling technique analysis
- **Performance Trends**: Long-term association analytics

## Implementation Timeline

| Phase | Duration | Key Deliverables |
|-------|----------|------------------|
| Phase 1 | Week 1 | Core association engine |
| Phase 2 | Week 2 | RESTful API endpoints |
| Phase 3 | Week 3 | User interface components |
| Phase 4 | Week 4 | Testing and optimization |

## Dependencies

### External Libraries
- **fit-file-parser**: FIT file parsing (already installed)
- **Supabase**: Database operations (already configured)
- **Next.js**: API routes and UI components (already configured)

### Internal Dependencies
- **Database Schema**: Association tracking tables (completed)
- **Authentication**: User data isolation (already configured)
- **File Upload**: IMU and FIT file handling (already implemented)

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
