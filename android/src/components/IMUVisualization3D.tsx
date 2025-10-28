/**
 * IMU 3D Visualization Component
 *
 * Renders a 3D cube with orientation based on IMU data (roll/pitch/yaw)
 * using Canvas 2D with projection (no external dependencies)
 */

import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { WebView } from 'react-native-webview';

interface IMUVisualization3DProps {
  roll: number;      // Roll angle in degrees
  pitch: number;     // Pitch angle in degrees
  yaw: number;       // Yaw angle in degrees
  accelX?: number;   // Acceleration X (m/s²)
  accelY?: number;   // Acceleration Y (m/s²)
  accelZ?: number;   // Acceleration Z (m/s²)
  width?: number;    // Canvas width
  height?: number;   // Canvas height
  backgroundColor?: string; // Background color to match card
}

const IMUVisualization3D: React.FC<IMUVisualization3DProps> = ({
  roll = 0,
  pitch = 0,
  yaw = 0,
  accelX = 0,
  accelY = 0,
  accelZ = 0,
  width = Dimensions.get('window').width - 32,
  height = (Dimensions.get('window').width - 32) * 0.8, // 20% shorter than width
  backgroundColor = 'hsl(0, 0%, 100%)', // Default to white
}) => {
  // Convert HSL to RGB for better WebView compatibility
  const hslToRgb = (hsl: string): string => {
    const match = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (!match) return hsl; // Return as-is if not HSL format

    const h = parseInt(match[1]) / 360;
    const s = parseInt(match[2]) / 100;
    const l = parseInt(match[3]) / 100;

    let r, g, b;
    if (s === 0) {
      r = g = b = l; // Achromatic
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }

    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  };

  const rgbBackgroundColor = hslToRgb(backgroundColor);

  const webViewRef = useRef<WebView>(null);

  // Update orientation and acceleration
  useEffect(() => {
    if (webViewRef.current) {
      const message = JSON.stringify({
        type: 'update',
        roll,
        pitch,
        yaw,
        accelX,
        accelY,
        accelZ,
        backgroundColor: rgbBackgroundColor,
      });
      webViewRef.current.postMessage(message);
    }
  }, [roll, pitch, yaw, accelX, accelY, accelZ, rgbBackgroundColor]);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body, html {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: ${rgbBackgroundColor};
      margin: 0;
      padding: 0;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      background: ${rgbBackgroundColor};
    }
  </style>
</head>
<body>
  <canvas id="canvas" width="${width}" height="${height}"></canvas>
  <script>
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    let currentRoll = 0, currentPitch = 0, currentYaw = 0;
    let currentAccelX = 0, currentAccelY = 0, currentAccelZ = 0;
    let currentBackgroundColor = '${rgbBackgroundColor}';

    // 3D rotation matrices
    function rotateX(point, angle) {
      const rad = angle * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      return [
        point[0],
        point[1] * cos - point[2] * sin,
        point[1] * sin + point[2] * cos
      ];
    }

    function rotateY(point, angle) {
      const rad = angle * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      return [
        point[0] * cos + point[2] * sin,
        point[1],
        -point[0] * sin + point[2] * cos
      ];
    }

    function rotateZ(point, angle) {
      const rad = angle * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      return [
        point[0] * cos - point[1] * sin,
        point[0] * sin + point[1] * cos,
        point[2]
      ];
    }

    // Project 3D to 2D
    function project(point) {
      const scale = 200;
      const distance = 4;
      const z = point[2] + distance;
      return [
        w/2 + (point[0] * scale) / z,
        h/2 - (point[1] * scale) / z
      ];
    }

    // Draw line
    function line(p1, p2, color = 'white', lineWidth = 2) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.stroke();
    }

    // Cube vertices (Y and Z swapped to match sensor coordinate system)
    const cubeSize = 1;
    const vertices = [
      [-cubeSize, -cubeSize, -cubeSize],  // 0
      [ cubeSize, -cubeSize, -cubeSize],  // 1
      [ cubeSize, -cubeSize,  cubeSize],  // 2 (swapped Y and Z)
      [-cubeSize, -cubeSize,  cubeSize],  // 3 (swapped Y and Z)
      [-cubeSize,  cubeSize, -cubeSize],  // 4 (swapped Y and Z)
      [ cubeSize,  cubeSize, -cubeSize],  // 5 (swapped Y and Z)
      [ cubeSize,  cubeSize,  cubeSize],  // 6
      [-cubeSize,  cubeSize,  cubeSize]   // 7
    ];

    // Cube edges
    const edges = [
      [0,1],[1,2],[2,3],[3,0], // back face
      [4,5],[5,6],[6,7],[7,4], // front face
      [0,4],[1,5],[2,6],[3,7]  // connecting edges
    ];

    function draw() {
      // Clear canvas with background color
      ctx.fillStyle = currentBackgroundColor;
      ctx.fillRect(0, 0, w, h);

      // Green cube color (matching success/status indicators)
      const cubeColor = 'hsl(142, 76%, 36%)';

      // Default viewing angles - 3/4 perspective view
      // View from front-left, looking down at cube flat on surface
      const viewPitch = 0;   // Looking down from above at 30°
      const viewYaw = -20;     // Viewing from left side at 30°
      const viewRoll = 60;

      // Combine device rotation with default view angles
      // Negate pitch to fix Y-axis inversion
      const totalPitch = -currentPitch + viewPitch;
      const totalYaw = currentYaw + viewYaw;
      const totalRoll = currentRoll + viewRoll;

      // Calculate directional translation based on acceleration
      // Scale factor: 0.025 means 1 m/s² = 0.025 cube units of movement
      const scaleFactor = 0.025;
      const translateX = currentAccelX * scaleFactor;
      const translateY = currentAccelY * scaleFactor;
      const translateZ = currentAccelZ * scaleFactor;

      // Rotate and project cube vertices with combined angles
      // Standard 3D rotations using Tait-Bryan angles (intrinsic rotations)
      // BNO055 coordinate system:
      // - Roll: rotation around X axis (side-to-side tilt)
      // - Pitch: rotation around Y axis (nose up/down)
      // - Yaw: rotation around Z axis (compass heading)
      const rotatedVertices = vertices.map(v => {
        let p = rotateZ(v, totalYaw);    // Yaw around Z axis (heading)
        p = rotateY(p, totalPitch);      // Pitch around Y axis (nose up/down)
        p = rotateX(p, totalRoll);       // Roll around X axis (side tilt)
        // Apply directional translation based on acceleration [x, y, z]
        p = [p[0] + translateX, p[1] + translateY, p[2] + translateZ];
        return project(p);
      });

      // Draw front face with distinct color
      // Bottom face vertices: 0, 1, 2, 3 (-Y face)
      const frontFace = [0, 1, 2, 3];
      ctx.beginPath();
      ctx.moveTo(rotatedVertices[frontFace[0]][0], rotatedVertices[frontFace[0]][1]);
      for (let i = 1; i < frontFace.length; i++) {
        ctx.lineTo(rotatedVertices[frontFace[i]][0], rotatedVertices[frontFace[i]][1]);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 165, 0, 0.4)'; // Orange front face
      ctx.fill();

      // Draw cube edges
      edges.forEach(edge => {
        line(rotatedVertices[edge[0]], rotatedVertices[edge[1]], cubeColor, 2);
      });

      requestAnimationFrame(draw);
    }

    // Listen for messages from React Native
    function handleMessage(event) {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'update') {
          currentRoll = data.roll || 0;
          currentPitch = data.pitch || 0;
          currentYaw = data.yaw || 0;
          currentAccelX = data.accelX || 0;
          currentAccelY = data.accelY || 0;
          currentAccelZ = data.accelZ || 0;
          if (data.backgroundColor) {
            currentBackgroundColor = data.backgroundColor;
          }
        }
      } catch (e) {
        console.error('Parse error:', e);
      }
    }

    window.addEventListener('message', handleMessage);
    document.addEventListener('message', handleMessage); // For Android

    // Start rendering
    draw();
  </script>
</body>
</html>
  `;

  return (
    <View style={[styles.container, { width, height, backgroundColor: rgbBackgroundColor }]}>
      <WebView
        ref={webViewRef}
        source={{ html }}
        style={{ width, height, backgroundColor: rgbBackgroundColor }}
        injectedJavaScript={`
          document.body.style.backgroundColor = '${rgbBackgroundColor}';
          document.documentElement.style.backgroundColor = '${rgbBackgroundColor}';
          true;
        `}
        scrollEnabled={false}
        bounces={false}
        scalesPageToFit={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        originWhitelist={['*']}
        javaScriptEnabled={true}
        mixedContentMode="always"
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          console.error('[IMUVisualization3D] WebView error:', nativeEvent);
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
});

export default IMUVisualization3D