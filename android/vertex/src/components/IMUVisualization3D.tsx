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
}

const IMUVisualization3D: React.FC<IMUVisualization3DProps> = ({
  roll = 0,
  pitch = 0,
  yaw = 0,
  accelX = 0,
  accelY = 0,
  accelZ = 0,
  width = Dimensions.get('window').width - 32,
  height = Dimensions.get('window').width - 32, // Square aspect ratio
}) => {
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
      });
      webViewRef.current.postMessage(message);
    }
  }, [roll, pitch, yaw, accelX, accelY, accelZ]);

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
      background: transparent;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
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
      // Clear canvas with transparent background
      ctx.clearRect(0, 0, w, h);

      // Green cube color (matching success/status indicators)
      const cubeColor = 'hsl(142, 76%, 36%)';

      // Default viewing angles - front face (positive X) faces viewer when zeroed
      const viewPitch = -10;   // Slight tilt down for better perspective
      const viewYaw = 120;     // Rotate to bring positive X face forward
      const viewRoll = 0;

      // Combine device rotation with default view angles
      const totalPitch = currentPitch + viewPitch;
      const totalYaw = currentYaw + viewYaw;
      const totalRoll = currentRoll + viewRoll;

      // Calculate directional translation based on acceleration axes
      // Scale factor: 0.025 means 1 m/s² = 0.025 cube units of movement
      const scaleFactor = 0.025;
      const translateX = currentAccelX * scaleFactor;
      const translateY = currentAccelZ * scaleFactor; // Z becomes Y in our coordinate system
      const translateZ = currentAccelY * scaleFactor; // Y becomes Z in our coordinate system

      // Rotate and project cube vertices with combined angles
      // Note: Y and Z are swapped in our coordinate system
      // Vertices are [x, z, y] so rotations map differently:
      // - Pitch (around Y, now at index 2) uses rotateZ
      // - Yaw (around Z, now at index 1) uses rotateY
      // - Roll (around X, still at index 0) uses rotateX
      const rotatedVertices = vertices.map(v => {
        let p = rotateZ(v, totalPitch);  // Pitch around Y
        p = rotateY(p, totalYaw);        // Yaw around Z
        p = rotateX(p, totalRoll);       // Roll around X
        // Apply directional translation based on acceleration
        // Our coordinate system is [x, z, y] where z and y are swapped
        p = [p[0] + translateX, p[1] + translateY, p[2] + translateZ];
        return project(p);
      });

      // Draw front face (positive X) with slight fill
      // Front face vertices: 1, 2, 6, 5 (right face in original cube)
      const frontFace = [1, 2, 6, 5];
      ctx.beginPath();
      ctx.moveTo(rotatedVertices[frontFace[0]][0], rotatedVertices[frontFace[0]][1]);
      for (let i = 1; i < frontFace.length; i++) {
        ctx.lineTo(rotatedVertices[frontFace[i]][0], rotatedVertices[frontFace[i]][1]);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'; // Subtle white overlay
      ctx.fill();

      // Draw "FRONT" label on the front face, rotated with the face
      const frontCenter = [
        (rotatedVertices[1][0] + rotatedVertices[2][0] + rotatedVertices[6][0] + rotatedVertices[5][0]) / 4,
        (rotatedVertices[1][1] + rotatedVertices[2][1] + rotatedVertices[6][1] + rotatedVertices[5][1]) / 4
      ];

      // Calculate rotation angle from face orientation (using horizontal edge: vertex 1 to vertex 2)
      const bottomLeft = rotatedVertices[1];
      const bottomRight = rotatedVertices[2];
      const angle = Math.atan2(bottomRight[1] - bottomLeft[1], bottomRight[0] - bottomLeft[0]);

      // Save context, rotate, draw text, restore
      ctx.save();
      ctx.translate(frontCenter[0], frontCenter[1]);
      ctx.rotate(angle);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FRONT', 0, 0);
      ctx.restore();

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
    <View style={[styles.container, { width, height }]}>
      <WebView
        ref={webViewRef}
        source={{ html }}
        style={{ width, height, backgroundColor: 'transparent' }}
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

export default IMUVisualization3D;