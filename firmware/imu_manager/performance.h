/*
 * Performance Tracker - Monitors system performance metrics
 * Tracks sample rates, timing, and resource usage
 */

#ifndef PERFORMANCE_H
#define PERFORMANCE_H

#include <Arduino.h>
#include "config.h"

struct PerformanceMetrics {
  unsigned long sensorReadTime;    // microseconds
  unsigned long bleNotifyTime;     // microseconds
  unsigned long loopTime;          // microseconds
  unsigned long maxLoopTime;       // microseconds
  float cpuTemp;                   // Celsius
  unsigned long sampleCount;

  // Battery and power tracking
  float batteryVoltageStart;       // Voltage when session started
  float batteryVoltageCurrent;     // Current voltage
  float batteryVoltageMin;         // Minimum voltage seen
  float batteryVoltageMax;         // Maximum voltage seen
  unsigned long sessionStartTime;  // millis() when init() called
  float totalVoltageDropMv;        // Total voltage drop in mV
  float voltageDropPerHour;        // mV/hour discharge rate
  float estimatedCurrentMa;        // Estimated current draw in mA
  float estimatedPowerMw;          // Estimated power consumption in mW
};

class PerformanceTracker {
public:
  PerformanceTracker();

  // Initialize performance tracking (pass initial battery voltage)
  void init(float initialBatteryVoltage);

  // Record that a sample was taken
  void recordSample();

  // Record loop timing
  void recordLoopStart();
  void recordLoopEnd();

  // Update metrics from managers
  void updateMetrics(unsigned long sensorReadTime, unsigned long bleNotifyTime);

  // Update battery voltage reading
  void updateBatteryVoltage(float voltage);

  // Report performance (call periodically)
  void report(unsigned long sampleIntervalMs);

private:
  PerformanceMetrics metrics;
  unsigned long lastReportTime;
  unsigned long loopStartTime;
};

#endif // PERFORMANCE_H
