# Charting Libraries for React Native

This document outlines the charting libraries used in the Vertex Android app and provides information about alternatives for future enhancements.

## Current Implementation: Victory Native

The app currently uses **Victory Native** for data visualization in the DataDetailScreen.

### Features Used
- Multi-series line charts (X, Y, Z axes)
- Chart legends with color-coded data series
- Axis labels and grid lines
- Data downsampling (simple step-based approach)

### Implementation Details
- **Location**: `/src/screens/DataDetailScreen.tsx`
- **Chart Types**: Time-series line charts
- **Data Types**: Accelerometer (m/s²), Gyroscope (rad/s), Magnetometer (µT)
- **Performance**: Downsampling to max 500 points per series

### Pros
- Declarative API similar to D3.js
- Good React Native integration
- Supports zoom/pan with VictoryZoomContainer
- Well-maintained library
- Easy to implement multi-series charts

### Cons
- Performance limitations with very large datasets (>1000 points)
- Limited customization compared to lower-level libraries
- Chart animation performance can be inconsistent
- Bundle size impact (~300KB)

## Future Alternative: React Native Skia

For future complex charting needs that require higher performance or more customization, consider **react-native-skia**.

### Overview
React Native Skia is a high-performance 2D graphics library built on Google's Skia graphics engine. It provides direct access to the canvas and enables complex, performant visualizations.

### Key Advantages

1. **Performance**
   - Hardware-accelerated rendering
   - Can handle 10,000+ data points smoothly
   - 60fps animations even with complex visualizations
   - Efficient memory usage

2. **Flexibility**
   - Complete control over rendering
   - Custom chart types and interactions
   - Advanced visual effects (gradients, shadows, blur)
   - Pixel-perfect rendering

3. **Integration with React Native**
   - React-first API with hooks
   - Declarative syntax
   - Works with Reanimated for smooth animations

### Use Cases for Skia

Consider migrating to Skia when:
- Datasets exceed 1000 samples per series
- Custom interactions needed (e.g., advanced gestures, custom tooltips)
- Real-time streaming visualization required
- Performance profiling shows Victory is a bottleneck
- Need for advanced visual effects

### Example: Basic Line Chart in Skia

```tsx
import { Canvas, Path, Skia } from '@shopify/react-native-skia';

const SkiaLineChart = ({ data, width, height }) => {
  // Create path for line
  const path = Skia.Path.Make();
  const xScale = width / data.length;
  const yScale = height / Math.max(...data.map(d => d.y));

  path.moveTo(0, height - data[0].y * yScale);
  data.forEach((point, i) => {
    path.lineTo(i * xScale, height - point.y * yScale);
  });

  return (
    <Canvas style={{ width, height }}>
      <Path
        path={path}
        color="red"
        style="stroke"
        strokeWidth={2}
      />
    </Canvas>
  );
};
```

### Migration Considerations

If migrating from Victory to Skia:

1. **Implementation Time**: Skia requires more code for basic charts
2. **Learning Curve**: Lower-level API requires understanding canvas concepts
3. **Testing**: More complex to test visual output
4. **Accessibility**: Need to implement accessibility features manually
5. **Bundle Size**: ~1.5MB (but better tree-shaking)

### Advanced Skia Features for IMU Data

For IMU data visualization, Skia could enable:
- **Real-time streaming**: Update charts as data arrives
- **Gradient fills**: Show magnitude through color gradients
- **Custom gestures**: Pinch-to-zoom, pan, precise scrubbing
- **Multi-chart sync**: Synchronized zooming across accelerometer/gyro/mag
- **3D orientation visualization**: Render 3D cube showing device orientation
- **LTTB downsampling**: Implement proper Largest-Triangle-Three-Buckets algorithm

### Installation (Future Reference)

```bash
npm install @shopify/react-native-skia
cd ios && pod install
```

### Resources

- [React Native Skia Documentation](https://shopify.github.io/react-native-skia/)
- [React Native Skia Examples](https://github.com/Shopify/react-native-skia/tree/main/example)
- [Skia Performance Tips](https://shopify.github.io/react-native-skia/docs/performance/performance-tips)

## Comparison: Victory vs Skia

| Feature | Victory Native | React Native Skia |
|---------|---------------|-------------------|
| **Ease of Use** | ⭐⭐⭐⭐⭐ Very easy | ⭐⭐⭐ Moderate |
| **Performance** | ⭐⭐⭐ Good (<1000 pts) | ⭐⭐⭐⭐⭐ Excellent (10k+ pts) |
| **Customization** | ⭐⭐⭐ Limited | ⭐⭐⭐⭐⭐ Complete control |
| **Bundle Size** | ⭐⭐⭐⭐ ~300KB | ⭐⭐⭐ ~1.5MB |
| **Maintenance** | ⭐⭐⭐⭐ Active | ⭐⭐⭐⭐⭐ Very active |
| **Learning Curve** | ⭐⭐⭐⭐⭐ Minimal | ⭐⭐⭐ Moderate |
| **Animations** | ⭐⭐⭐ Basic | ⭐⭐⭐⭐⭐ Advanced |

## Recommendation

**Current State**: Victory Native is appropriate for the current implementation with downsampled data (<500 points per series).

**Future Migration**: Consider Skia when:
1. Users report performance issues
2. Real-time streaming visualization is needed
3. Advanced interactions are requested
4. Need to visualize full datasets without downsampling

## Related Files

- `/src/screens/DataDetailScreen.tsx` - Current Victory implementation
- `/src/services/FileService.ts` - CSV data parsing
- Web app: `/src/components/imu-uplot-charts.tsx` - Reference implementation using uPlot
