# State Management Architecture

## Overview

The Vertex Android app uses **Zustand** for global state management, replacing the previous useState-heavy approach that led to prop drilling, synchronization issues, and component complexity.

## Why Zustand?

- **Zero boilerplate**: No actions, reducers, or providers required
- **TypeScript-first**: Full type safety with minimal configuration
- **Lightweight**: ~1KB bundle size
- **Simple API**: Clean hooks-based interface
- **React Native optimized**: No performance overhead

## Store Architecture

The app uses three specialized stores:

### 1. Device Store (`src/stores/deviceStore.ts`)

**Purpose**: Global state for BLE device connection, battery, and sensor data

**State**:
```typescript
{
  // Connection
  deviceId: string | null
  deviceName: string | null
  isConnected: boolean
  isConnecting: boolean
  connectionError: string | null

  // Battery
  batteryLevel: number | null      // 0-100 percentage
  batteryVoltage: number | null    // Voltage value
  isCharging: boolean | null

  // Sensor data
  latestReading: SensorReading | null
  sampleRate: number | null        // Hz
}
```

**Usage**:
```typescript
import { useDeviceStore } from '../stores/deviceStore';

// Subscribe to specific state
const { isConnected, batteryLevel } = useDeviceStore();

// Update state
const { setConnectionStatus, setBattery } = useDeviceStore();
setConnectionStatus(true);
setBattery(85, 3.7);
```

**Key Features**:
- Centralized device status available to all components
- Eliminates prop drilling for connection/battery state
- Real-time sensor data updates via DeviceStatusService

---

### 2. Recording Store (`src/stores/recordingStore.ts`)

**Purpose**: Global state for recording sessions and real-time stats

**State**:
```typescript
{
  // Session
  session: RecordingSession | null

  // Real-time stats
  stats: {
    duration: number           // milliseconds
    sampleCount: number
    fileSize: number          // bytes
    droppedSamples: number
  }

  // UI state
  isStarting: boolean
  isStopping: boolean
  isPaused: boolean
  error: string | null

  // Zero point calibration
  zeroPoint: any | null
  isZeroing: boolean
}
```

**Usage**:
```typescript
import { useRecordingStore } from '../stores/recordingStore';

const { session, stats, isStarting } = useRecordingStore();
const { setSession, updateStats } = useRecordingStore();

// Update file size and sample count
updateStats({ fileSize: 1024000, sampleCount: 15000 });
```

**Key Features**:
- Replaces 10+ useState hooks from RecordScreen
- Consistent stats updates across UI
- Simplified recording state management

---

### 3. App Store (`src/stores/appStore.ts`)

**Purpose**: Global state for app-level settings and preferences

**State**:
```typescript
{
  selectedBike: string
  selectedPosition: string
  recordingFormat: 'vtx' | 'csv'
}
```

**Usage**:
```typescript
import { useAppStore } from '../stores/appStore';

const { selectedBike, recordingFormat } = useAppStore();
const { setSelectedBike, setRecordingFormat } = useAppStore();

setSelectedBike('Bike 2');
setRecordingFormat('vtx');
```

**Key Features**:
- Persists user preferences across screens
- Eliminates redundant state declarations
- Single source of truth for app settings

---

## DeviceStatusService

**Location**: `src/services/DeviceStatusService.ts`

**Purpose**: Centralized service for polling device status and updating stores

### How It Works

1. **Start Monitoring**:
```typescript
DeviceStatusService.startMonitoring(deviceId, deviceName);
```

2. **Automatic Polling**:
   - **Connection status**: Every 2 seconds
   - **Battery status**: Every 10 seconds
   - **Sensor data**: Real-time stream subscription

3. **Store Updates**:
   - Automatically updates `deviceStore` with latest status
   - No manual state management required
   - Available to all components instantly

4. **Stop Monitoring**:
```typescript
DeviceStatusService.stopMonitoring();
```

### Implementation Details

```typescript
class DeviceStatusService {
  startMonitoring(deviceId, deviceName) {
    // Update device info
    useDeviceStore.getState().setDevice(deviceId, deviceName);

    // Poll connection every 2s
    setInterval(async () => {
      const isConnected = await BleService.isDeviceConnected(deviceId);
      useDeviceStore.getState().setConnectionStatus(isConnected);
    }, 2000);

    // Poll battery every 10s
    setInterval(async () => {
      const batteryData = await BleService.readBattery(deviceId);
      useDeviceStore.getState().setBattery(
        batteryData.percentage,
        batteryData.voltage
      );
    }, 10000);

    // Subscribe to sensor stream
    BleService.startIMUStream(deviceId, (data) => {
      useDeviceStore.getState().setLatestReading(data);
    });
  }
}
```

---

## Migration Guide

### Before (useState explosion):

```typescript
const RecordScreen = () => {
  const [session, setSession] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState(null);
  const [isConnected, setIsConnected] = useState(true);
  const [selectedBike, setSelectedBike] = useState('Bike 1');
  const [selectedPosition, setSelectedPosition] = useState('Body');
  const [zeroPoint, setZeroPoint] = useState(null);
  const [isZeroing, setIsZeroing] = useState(false);
  const [sensorReading, setSensorReading] = useState(null);
  const [recordingFormat, setRecordingFormat] = useState('vtx');
  // 10+ more useState calls...

  useEffect(() => {
    // Manual connection polling
    const interval = setInterval(checkConnection, 2000);
    return () => clearInterval(interval);
  }, []);

  const checkConnection = async () => {
    const connected = await BleService.isDeviceConnected(deviceId);
    setIsConnected(connected);
  };
};
```

**Issues**:
- 20+ useState calls in one component
- Manual polling logic scattered everywhere
- State synchronization bugs
- Prop drilling through component tree
- No shared state between screens

### After (Zustand + DeviceStatusService):

```typescript
const RecordScreen = () => {
  // Zustand stores - clean subscriptions
  const { isConnected, batteryLevel, sampleRate } = useDeviceStore();
  const { session, stats, isStarting, setSession } = useRecordingStore();
  const { selectedBike, recordingFormat, setSelectedBike } = useAppStore();

  // Local UI state only (dialogs)
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [activeSheet, setActiveSheet] = useState(null);

  useEffect(() => {
    // Single line - automatic polling handled by service
    DeviceStatusService.startMonitoring(deviceId, deviceName);

    return () => DeviceStatusService.stopMonitoring();
  }, []);
};
```

**Benefits**:
- Reduced from 20+ useState to 4 store subscriptions + 2 local UI states
- No manual polling logic
- Automatic state synchronization
- Battery/connection available everywhere
- Type-safe state access

---

## Best Practices

### 1. **Use stores for shared state**:
   - Device status (connection, battery)
   - Recording data (session, stats)
   - App preferences (bike, position, format)

### 2. **Use local useState for UI-only state**:
   - Dialog visibility (`showConfirm`, `activeSheet`)
   - Form inputs before submission
   - Temporary UI animations

### 3. **Subscribe to specific state**:
```typescript
// ✅ Good - only re-renders on batteryLevel change
const { batteryLevel } = useDeviceStore();

// ❌ Bad - re-renders on any store change
const store = useDeviceStore();
```

### 4. **Update stores from services**:
```typescript
// ✅ Good - centralized in DeviceStatusService
DeviceStatusService.startMonitoring(deviceId, deviceName);

// ❌ Bad - manual polling in component
useEffect(() => {
  const interval = setInterval(pollBattery, 10000);
}, []);
```

### 5. **Reset stores on cleanup**:
```typescript
useEffect(() => {
  return () => {
    useDeviceStore.getState().reset();
    useRecordingStore.getState().reset();
  };
}, []);
```

---

## Performance Considerations

### Automatic Optimization

Zustand automatically optimizes re-renders:
- Only subscribing components re-render on state changes
- Shallow equality checks prevent unnecessary updates
- No provider overhead like Redux

### Measuring Impact

**Before**:
- RecordScreen: 20+ useState hooks
- Sample count updates: Inconsistent (10Hz, 20Hz, 30Hz on reconnects)
- Battery status: Not available on RecordScreen
- Multiple components polling BLE independently

**After**:
- RecordScreen: 4 store subscriptions + 2 UI states
- Sample count updates: Consistent via centralized service
- Battery status: Available globally
- Single DeviceStatusService polling BLE

---

## Troubleshooting

### Issue: State not updating

**Cause**: Not subscribing to store changes
```typescript
// ❌ Wrong - accessing outside component
const batteryLevel = useDeviceStore.getState().batteryLevel;

// ✅ Correct - hooks auto-subscribe
const { batteryLevel } = useDeviceStore();
```

### Issue: Too many re-renders

**Cause**: Subscribing to entire store
```typescript
// ❌ Wrong - re-renders on any change
const store = useDeviceStore();

// ✅ Correct - only subscribes to specific fields
const { batteryLevel, isConnected } = useDeviceStore();
```

### Issue: Stale data

**Cause**: Not calling store reset on unmount
```typescript
useEffect(() => {
  return () => {
    DeviceStatusService.stopMonitoring();
    useDeviceStore.getState().reset(); // Important!
  };
}, []);
```

---

## Future Enhancements

1. **Persist app store to AsyncStorage**:
```typescript
import create from 'zustand';
import { persist } from 'zustand/middleware';

export const useAppStore = create(
  persist(
    (set) => ({ /* state */ }),
    { name: 'vertex-app-storage' }
  )
);
```

2. **DevTools integration**:
```typescript
import { devtools } from 'zustand/middleware';

export const useDeviceStore = create(
  devtools((set) => ({ /* state */ }))
);
```

3. **Middleware for logging**:
```typescript
const log = (config) => (set, get, api) =>
  config(
    (...args) => {
      console.log('  applying', args);
      set(...args);
      console.log('  new state', get());
    },
    get,
    api
  );

export const useDeviceStore = create(log((set) => ({ /* state */ })));
```

---

## Summary

**Key Takeaways**:
- ✅ Zustand replaced 20+ useState calls with 3 clean stores
- ✅ DeviceStatusService centralized BLE polling
- ✅ Battery and connection now available globally
- ✅ Eliminated prop drilling and state synchronization bugs
- ✅ Type-safe state management with minimal boilerplate

**Files to Reference**:
- `src/stores/deviceStore.ts`
- `src/stores/recordingStore.ts`
- `src/stores/appStore.ts`
- `src/services/DeviceStatusService.ts`
- `src/screens/RecordScreen.tsx` (refactored example)
