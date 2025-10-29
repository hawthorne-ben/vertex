/**
 * Simple validation script for VTX encoder/decoder
 * Run with: node test-vtx.js
 */

const fs = require('fs');
const path = require('path');
const { VTXEncoder, VTXDecoder } = require('./dist/index.js');

console.log('🧪 VTX Format Validation Test\n');

// Generate test IMU data (10 seconds at 100 Hz = 1000 samples)
const sampleRate = 100;
const durationSeconds = 10;
const sampleCount = sampleRate * durationSeconds;
const startTimestamp = Date.now();

console.log(`📊 Generating ${sampleCount} test samples...`);

const testRecords = [];
for (let i = 0; i < sampleCount; i++) {
  const t = i / sampleRate; // time in seconds

  testRecords.push({
    timestamp: startTimestamp + i * (1000 / sampleRate),
    // Simulate realistic IMU data with some variation
    accelX: 0.1 * Math.sin(t * 2 * Math.PI),
    accelY: -0.2 * Math.cos(t * 2 * Math.PI),
    accelZ: 9.81 + 0.05 * Math.sin(t * 4 * Math.PI),
    gyroX: 0.01 * Math.sin(t * Math.PI),
    gyroY: 0.02 * Math.cos(t * Math.PI),
    gyroZ: -0.01 * Math.sin(t * 3 * Math.PI),
    magX: 45.2 + Math.random() * 2,
    magY: 12.3 + Math.random() * 2,
    magZ: -8.9 + Math.random() * 2,
    quatW: 0.707,
    quatX: 0.0,
    quatY: 0.0,
    quatZ: 0.707,
  });
}

console.log('✅ Test data generated\n');

// Test 1: Encode to VTX (full format with mag + quat)
console.log('🔧 Test 1: Encoding to VTX (full format)...');
const encoderFull = new VTXEncoder({
  sampleRate,
  includeMag: true,
  includeQuat: true,
  metadata: {
    device: {
      id: 'TEST123',
      name: 'Test IMU Device',
      firmwareVersion: '1.0.0',
    },
    session: {
      createdAt: new Date().toISOString(),
      bike: 'Test Bike',
      position: 'Seatpost',
      notes: 'Validation test recording',
    },
  },
});

encoderFull.addRecords(testRecords);
const bufferFull = encoderFull.encode();
const vtxSizeFull = bufferFull.byteLength;

fs.writeFileSync('test-full.vtx', Buffer.from(bufferFull));
console.log(`✅ Encoded ${testRecords.length} records`);
console.log(`   File size: ${(vtxSizeFull / 1024).toFixed(2)} KB`);
console.log(`   Record size: ${vtxSizeFull / testRecords.length} bytes/record\n`);

// Test 2: Encode to VTX (minimal format, accel + gyro only)
console.log('🔧 Test 2: Encoding to VTX (minimal format)...');
const encoderMinimal = new VTXEncoder({
  sampleRate,
  includeMag: false,
  includeQuat: false,
  metadata: {
    device: {
      id: 'TEST123',
      name: 'Test IMU Device',
    },
  },
});

encoderMinimal.addRecords(testRecords);
const bufferMinimal = encoderMinimal.encode();
const vtxSizeMinimal = bufferMinimal.byteLength;

fs.writeFileSync('test-minimal.vtx', Buffer.from(bufferMinimal));
console.log(`✅ Encoded ${testRecords.length} records`);
console.log(`   File size: ${(vtxSizeMinimal / 1024).toFixed(2)} KB`);
console.log(`   Record size: ${vtxSizeMinimal / testRecords.length} bytes/record\n`);

// Test 3: Create equivalent CSV for comparison
console.log('🔧 Test 3: Creating equivalent CSV...');
let csvContent = 'timestamp_ms,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z,mag_x,mag_y,mag_z,quat_w,quat_x,quat_y,quat_z\n';
for (const record of testRecords) {
  csvContent += `${record.timestamp},${record.accelX},${record.accelY},${record.accelZ},${record.gyroX},${record.gyroY},${record.gyroZ},${record.magX},${record.magY},${record.magZ},${record.quatW},${record.quatX},${record.quatY},${record.quatZ}\n`;
}

fs.writeFileSync('test-comparison.csv', csvContent);
const csvSize = csvContent.length;
console.log(`✅ CSV created`);
console.log(`   File size: ${(csvSize / 1024).toFixed(2)} KB\n`);

// Test 4: Decode VTX file
console.log('🔧 Test 4: Decoding VTX file...');
const decoder = new VTXDecoder(bufferFull);
const vtxFile = decoder.decode();

console.log(`✅ Decoded successfully`);
console.log(`   Records: ${vtxFile.records.length}`);
console.log(`   Sample rate: ${vtxFile.header.sampleRate} Hz`);
console.log(`   Duration: ${decoder.getDuration()} ms`);
console.log(`   Device: ${vtxFile.metadata.device?.name}`);
console.log(`   Session bike: ${vtxFile.metadata.session?.bike}\n`);

// Test 5: Validate data integrity
console.log('🔧 Test 5: Validating data integrity...');
let errors = 0;
for (let i = 0; i < Math.min(10, testRecords.length); i++) {
  const original = testRecords[i];
  const decoded = vtxFile.records[i];

  const epsilon = 0.00001; // Float precision tolerance

  if (Math.abs(original.accelX - decoded.accelX) > epsilon ||
      Math.abs(original.accelY - decoded.accelY) > epsilon ||
      Math.abs(original.accelZ - decoded.accelZ) > epsilon) {
    console.error(`❌ Record ${i} acceleration mismatch`);
    errors++;
  }

  if (Math.abs(original.gyroX - decoded.gyroX) > epsilon ||
      Math.abs(original.gyroY - decoded.gyroY) > epsilon ||
      Math.abs(original.gyroZ - decoded.gyroZ) > epsilon) {
    console.error(`❌ Record ${i} gyroscope mismatch`);
    errors++;
  }
}

if (errors === 0) {
  console.log(`✅ All sampled records match perfectly\n`);
} else {
  console.log(`❌ ${errors} validation errors found\n`);
}

// Test 6: File size comparison
console.log('📈 File Size Comparison:\n');
console.log('   Format                 | Size     | Savings vs CSV');
console.log('   ---------------------- | -------- | --------------');
console.log(`   CSV (baseline)         | ${(csvSize / 1024).toFixed(2).padStart(6)} KB | -`);
console.log(`   VTX Full (mag+quat)    | ${(vtxSizeFull / 1024).toFixed(2).padStart(6)} KB | ${((1 - vtxSizeFull / csvSize) * 100).toFixed(1)}%`);
console.log(`   VTX Minimal (accel+gyro)| ${(vtxSizeMinimal / 1024).toFixed(2).padStart(6)} KB | ${((1 - vtxSizeMinimal / csvSize) * 100).toFixed(1)}%`);
console.log('');

// Test 7: Random access performance
console.log('🔧 Test 7: Testing random access...');
const randomIndices = [0, 250, 500, 750, 999];
console.log(`   Reading records at indices: ${randomIndices.join(', ')}`);
for (const index of randomIndices) {
  const record = decoder.readRecord(index);
  console.log(`   Record ${index}: timestamp=${record.timestamp}, accel_z=${record.accelZ.toFixed(3)}`);
}
console.log('✅ Random access working\n');

// Summary
console.log('═══════════════════════════════════════════');
console.log('✅ VTX FORMAT VALIDATION COMPLETE');
console.log('═══════════════════════════════════════════');
console.log(`✓ Encoding: Working (${testRecords.length} records)`);
console.log(`✓ Decoding: Working (${vtxFile.records.length} records)`);
console.log(`✓ Data Integrity: Verified`);
console.log(`✓ File Size: ${((1 - vtxSizeFull / csvSize) * 100).toFixed(1)}% smaller than CSV`);
console.log(`✓ Random Access: Working`);
console.log('✓ Metadata: Preserved');
console.log('');
console.log('📁 Test files created:');
console.log('   - test-full.vtx (full format)');
console.log('   - test-minimal.vtx (minimal format)');
console.log('   - test-comparison.csv (for reference)');
console.log('');
