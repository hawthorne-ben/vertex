/*
 * Sensor Manager V2 Implementation
 * LSM6DS3 initialization and direct register reads over I2C.
 * Converts raw register values to physical units (m/s², rad/s).
 */

#include "sensor_manager.h"

// LSM6DS3 register addresses
#define LSM6DS3_WHO_AM_I        0x0F
#define LSM6DS3_CTRL1_XL        0x10  // Accel ODR + range
#define LSM6DS3_CTRL2_G         0x11  // Gyro ODR + range
#define LSM6DS3_CTRL3_C         0x12  // Control register 3
#define LSM6DS3_FIFO_CTRL3      0x08  // FIFO decimation config
#define LSM6DS3_FIFO_CTRL5      0x0A  // FIFO mode + ODR
#define LSM6DS3_FIFO_STATUS1    0x3A  // FIFO word count low
#define LSM6DS3_FIFO_STATUS2    0x3B  // FIFO word count high + flags
#define LSM6DS3_FIFO_DATA_OUT_L 0x3E  // FIFO data output
#define LSM6DS3_STATUS_REG      0x1E  // Data ready flags
#define LSM6DS3_OUTX_L_G        0x22  // Gyro output registers (6 bytes)
#define LSM6DS3_OUTX_L_XL       0x28  // Accel output registers (6 bytes)
#define LSM6DS3_WHO_AM_I_VALUE  0x69

SensorManager::SensorManager()
  : _recordingStartMs(0) {
  memset(_buffer, 0, sizeof(_buffer));
}

bool SensorManager::init() {
  Serial.println("[IMU] Initializing LSM6DS3...");

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(I2C_CLOCK_SPEED);

  // Verify WHO_AM_I (retry up to 3 times for cold-boot I2C flakiness)
  uint8_t whoAmI = 0xFF;
  for (int attempt = 0; attempt < 3; attempt++) {
    whoAmI = readRegister(LSM6DS3_WHO_AM_I);
    if (whoAmI == LSM6DS3_WHO_AM_I_VALUE) break;
    Serial.printf("[IMU] WHO_AM_I attempt %d: got 0x%02X\n", attempt + 1, whoAmI);
    delay(50);
  }
  if (whoAmI != LSM6DS3_WHO_AM_I_VALUE) {
    Serial.printf("[IMU] WHO_AM_I failed after retries: 0x%02X\n", whoAmI);
    return false;
  }
  Serial.println("[IMU] LSM6DS3 detected");

  // CTRL3_C: BDU=1 (block data update), IF_INC=1 (auto-increment register addr)
  writeRegister(LSM6DS3_CTRL3_C, 0x44);

  // CTRL1_XL: ODR=104Hz (0x40), FS=+/-8g (0x0C) → 0x4C
  writeRegister(LSM6DS3_CTRL1_XL, 0x4C);

  // CTRL2_G: ODR=104Hz (0x40), FS=+/-1000dps (0x08) → 0x48
  writeRegister(LSM6DS3_CTRL2_G, 0x48);

  // FIFO_CTRL3: No decimation for gyro (0x01) + no decimation for accel (0x08)
  writeRegister(LSM6DS3_FIFO_CTRL3, 0x09);

  // FIFO_CTRL5: First set bypass mode to reset FIFO, then continuous mode
  writeRegister(LSM6DS3_FIFO_CTRL5, 0x00);  // Bypass (reset)
  delay(10);
  // FIFO_CTRL5: Continuous mode (0x06) + 104Hz FIFO ODR (0x20)
  writeRegister(LSM6DS3_FIFO_CTRL5, 0x26);

  // Verify registers were written
  uint8_t ctrl1 = readRegister(LSM6DS3_CTRL1_XL);
  uint8_t ctrl2 = readRegister(LSM6DS3_CTRL2_G);
  uint8_t ctrl3 = readRegister(LSM6DS3_CTRL3_C);
  uint8_t fifo3 = readRegister(LSM6DS3_FIFO_CTRL3);
  uint8_t fifo5 = readRegister(LSM6DS3_FIFO_CTRL5);
  Serial.printf("[IMU] CTRL1_XL=0x%02X CTRL2_G=0x%02X CTRL3_C=0x%02X\n", ctrl1, ctrl2, ctrl3);
  Serial.printf("[IMU] FIFO_CTRL3=0x%02X FIFO_CTRL5=0x%02X\n", fifo3, fifo5);

  Serial.printf("[IMU] Configured: %dHz, +/-%dg, +/-%ddps, FIFO continuous\n",
                IMU_ODR_HZ, IMU_ACCEL_RANGE, IMU_GYRO_RANGE);

  _initialized = true;
  return true;
}

int SensorManager::readFIFO() {
  if (!_initialized) return 0;

  // Read FIFO word count from STATUS registers
  uint8_t status1 = readRegister(LSM6DS3_FIFO_STATUS1);
  uint8_t status2 = readRegister(LSM6DS3_FIFO_STATUS2);
  uint16_t fifoWords = (uint16_t)status1 | (((uint16_t)(status2 & 0x07)) << 8);

  if (fifoWords < 6) return 0;  // Need at least 1 complete sample (6 words)

  // Each sample = 6 words (3 gyro + 3 accel), each word = 2 bytes
  int numSamples = fifoWords / 6;
  if (numSamples > MAX_FIFO_SAMPLES) numSamples = MAX_FIFO_SAMPLES;

  // Read FIFO data: each word is 2 bytes at 0x3E-0x3F.
  // LSM6DS3 FIFO does NOT support burst reads beyond 2 bytes —
  // auto-increment goes past 0x3F into unrelated registers.
  // Read 2 bytes per word (one I2C transaction per word).
  int totalWords = numSamples * 6;  // 6 words per sample
  uint8_t rawBuf[MAX_FIFO_SAMPLES * 12];
  for (int w = 0; w < totalWords; w++) {
    if (!readRegisters(LSM6DS3_FIFO_DATA_OUT_L, &rawBuf[w * 2], 2)) return 0;
  }

  unsigned long now = millis();

  // Parse samples: FIFO pattern is gyro XYZ then accel XYZ (each int16 LE)
  for (int i = 0; i < numSamples; i++) {
    uint8_t* p = &rawBuf[i * 12];

    int16_t gx = (int16_t)(p[0] | (p[1] << 8));
    int16_t gy = (int16_t)(p[2] | (p[3] << 8));
    int16_t gz = (int16_t)(p[4] | (p[5] << 8));

    int16_t ax = (int16_t)(p[6] | (p[7] << 8));
    int16_t ay = (int16_t)(p[8] | (p[9] << 8));
    int16_t az = (int16_t)(p[10] | (p[11] << 8));

    _buffer[i].timestamp_ms = now - _recordingStartMs;
    _buffer[i].accel_x = (float)ax * ACCEL_SCALE;
    _buffer[i].accel_y = (float)ay * ACCEL_SCALE;
    _buffer[i].accel_z = (float)az * ACCEL_SCALE;
    _buffer[i].gyro_x = (float)gx * GYRO_SCALE;
    _buffer[i].gyro_y = (float)gy * GYRO_SCALE;
    _buffer[i].gyro_z = (float)gz * GYRO_SCALE;
  }

  return numSamples;
}

const IMURecord* SensorManager::getSampleBuffer() const {
  return _buffer;
}

void SensorManager::resetTimestamp() {
  _recordingStartMs = millis();
}

void SensorManager::getLatestAccel(float &ax, float &ay, float &az) const {
  ax = _buffer[0].accel_x;
  ay = _buffer[0].accel_y;
  az = _buffer[0].accel_z;
}

// --- I2C register helpers ---

bool SensorManager::writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(IMU_I2C_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

uint8_t SensorManager::readRegister(uint8_t reg) {
  Wire.beginTransmission(IMU_I2C_ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)IMU_I2C_ADDR, (uint8_t)1);
  return Wire.available() ? Wire.read() : 0xFF;
}

bool SensorManager::readRegisters(uint8_t reg, uint8_t* buffer, uint8_t length) {
  Wire.beginTransmission(IMU_I2C_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;

  Wire.requestFrom((uint8_t)IMU_I2C_ADDR, length);
  for (uint8_t i = 0; i < length && Wire.available(); i++) {
    buffer[i] = Wire.read();
  }
  return true;
}
