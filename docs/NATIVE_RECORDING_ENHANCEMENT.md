# Native Recording Enhancement

## Overview

This document outlines a future enhancement to move BLE data recording to a native Android service for improved performance and reliability. This is **not currently implemented** but represents the ideal architecture for production-quality IMU recording.

## Current Architecture (v0.2.0)

**Foreground Recording with Optimized Buffering:**
- BLE subscription on React Native main thread
- Large in-memory buffers (1000 samples = 10 seconds)
- Async file writes with event loop yielding
- VTX stream encoder for efficient binary format

**Pros:**
- Pure TypeScript, easy to maintain
- Works with existing BLE infrastructure
- Good enough for ~100Hz data rates

**Cons:**
- Shares thread with UI rendering
- Limited to single-threaded JS performance
- Recording stops if app is killed

## Proposed Native Architecture

### Components

#### 1. Native Android Foreground Service
```kotlin
class VTXRecordingService : Service() {
    private val bleThread: HandlerThread
    private val fileThread: HandlerThread
    private val dataQueue: BlockingQueue<SensorSample>
}
```

**Responsibilities:**
- Maintain BLE connection on dedicated thread
- Queue incoming sensor data
- Write to file on background thread
- Survive app backgrounding/killing
- Show persistent notification

#### 2. Native VTX Writer Module
```kotlin
class NativeVTXWriter {
    external fun initialize(filePath: String, sampleRate: Int): Long
    external fun addRecord(handle: Long, record: FloatArray): Boolean
    external fun finalize(handle: Long): Boolean
}
```

**Responsibilities:**
- JNI bridge to C++ VTX encoder
- Zero-copy data transfer
- High-performance binary serialization

#### 3. React Native Bridge
```typescript
// TypeScript API
export class NativeRecordingService {
  static startRecording(config: RecordingConfig): Promise<string>
  static stopRecording(): Promise<RecordingStats>
  static addStatusListener(callback: StatusCallback): void
}
```

**Responsibilities:**
- Expose native functionality to React Native
- Bridge status updates back to UI
- Handle lifecycle events

### Data Flow

```
BLE Device
  ↓ [20-100 Hz]
Native BLE Thread (dedicated)
  ↓ [lock-free queue]
Native File Thread (dedicated)
  ↓ [batch writes]
VTX File
  ↑ [status updates]
React Native UI
```

### Threading Model

**Main Thread (React Native):**
- UI rendering only
- Receives status updates via bridge

**BLE Thread:**
- Maintains BLE connection
- Parses sensor packets
- Enqueues data to file thread

**File Thread:**
- Dequeues batched samples
- Encodes to VTX format
- Writes to disk
- Sends status updates

### Performance Benefits

| Metric | Current (RN) | Native Service |
|--------|--------------|----------------|
| Max Sample Rate | ~100 Hz | ~1000 Hz |
| UI Impact | Moderate | None |
| Survives App Kill | No | Yes |
| Battery Efficiency | Good | Excellent |
| Latency | ~100ms | ~10ms |

## Implementation Plan

### Phase 1: Native Module Skeleton
- Create Android module structure
- Set up JNI bridge for VTX encoding
- Implement basic C++ VTX writer

**Package:** `@vertex-pkg/vtx-native-recorder` (new)
**Dependencies:** `@vertex-pkg/vtx-parser` (for format spec)

### Phase 2: Native Service
- Implement Android Foreground Service
- Add BLE connection management
- Create thread pool and queue system
- Add notification management

### Phase 3: React Native Bridge
- Expose native API to TypeScript
- Implement status update callbacks
- Add lifecycle management
- Handle error propagation

### Phase 4: Testing & Migration
- Unit tests for native code
- Integration tests with real BLE device
- Performance benchmarking
- Migration guide from RN implementation

## Package Structure

```
@vertex-pkg/vtx-native-recorder/
├── android/
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/com/vertex/recording/
│   │   │   │   ├── VTXRecordingService.kt
│   │   │   │   ├── NativeVTXWriter.kt
│   │   │   │   └── RecordingModule.kt
│   │   │   └── cpp/
│   │   │       ├── vtx_encoder.cpp
│   │   │       └── vtx_encoder.h
│   │   └── test/
│   └── build.gradle
├── ios/
│   └── (iOS implementation)
├── src/
│   ├── index.ts              # TypeScript API
│   └── types.ts              # Type definitions
├── package.json
└── README.md
```

## Alternative: Hybrid Approach

Instead of full native implementation, keep BLE in React Native but move encoding to native:

```typescript
// React Native receives BLE data
BleService.subscribeToIMUStream((data) => {
  // Pass to native module for encoding/writing
  NativeVTXWriter.addRecord(data);
});
```

**Pros:**
- Leverages existing BLE code
- Less complex than full native service
- Still gets performance benefits for encoding

**Cons:**
- Bridge overhead for every sample
- BLE still on RN thread
- Doesn't survive app kill

## C++ VTX Encoder

The native encoder should be standalone C++ that can be:
- Used in native Android/iOS modules
- Compiled for embedded systems (ESP32 firmware)
- Tested independently

**NOT part of `@vertex-pkg/vtx-parser`** (keep that pure TypeScript)

```cpp
// Native C++ implementation
class VTXEncoder {
public:
    VTXEncoder(const Config& config);
    bool addRecord(const IMURecord& record);
    std::vector<uint8_t> finalize();

private:
    std::ofstream file_;
    uint32_t recordCount_;
    CompressionState compression_;
};
```

## When to Implement

**Implement native service when:**
- Recording sessions exceed 30 minutes regularly
- Sample rates approach or exceed 200 Hz
- App needs to record while backgrounded
- UI responsiveness is critical
- Battery life is a primary concern

**Current foreground approach is sufficient when:**
- Sample rates stay at 100 Hz or below
- Recording sessions under 30 minutes
- User keeps app in foreground
- UI performance is acceptable

## Firmware Consideration

The firmware broadcasting BLE data is a **separate concern** and should remain in its own repository or `/firmware` directory. It defines the BLE protocol but doesn't need to know about VTX format.

**Separation of concerns:**
```
Firmware (ESP32/Arduino)
  ↓ broadcasts raw BLE packets
App Layer (Native or RN)
  ↓ decodes and encodes
VTX Format (platform-agnostic spec)
```

## Cost-Benefit Analysis

**Development Cost:**
- 2-3 weeks for native Android implementation
- 2-3 weeks for native iOS implementation
- 1 week for testing and optimization
- Ongoing maintenance complexity

**Benefits:**
- 10x sample rate capability
- Zero UI impact
- Background recording
- Better battery life
- Professional-grade reliability

**Recommendation:**
Start with current foreground approach. Migrate to native only if performance requirements exceed 100Hz or background recording becomes essential.

## Resources

- [Android Foreground Service Guide](https://developer.android.com/guide/components/foreground-services)
- [React Native Native Modules](https://reactnative.dev/docs/native-modules-android)
- [Android NDK JNI Guide](https://developer.android.com/training/articles/perf-jni)
- [Lock-Free Queues in C++](https://www.boost.org/doc/libs/1_82_0/doc/html/lockfree.html)

## Status

**Current Status:** Not implemented
**Priority:** Low (current approach sufficient for requirements)
**Next Review:** Q2 2025 or when performance requirements change
