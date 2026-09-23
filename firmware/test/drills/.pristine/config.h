/*
 * Vertex IMU V2 Configuration
 * All constants and pin assignments for ESP32-S3 Mini + LSM6DS3
 */

#ifndef CONFIG_H
#define CONFIG_H

// ===== Firmware Version =====
#define FIRMWARE_VERSION "2.0.0"

// ===== VTX Format (must match packages/vtx-parser) =====
#define VTX_FORMAT_MAJOR 1
#define VTX_FORMAT_MINOR 2
#define VTX_MAGIC "VTX"                // 4 bytes on the wire: 'V','T','X','\0'
#define VTX_MAGIC_SIZE 4               // must match VTX_CONSTANTS.MAGIC in packages/vtx-constants
#define VTX_HEADER_SIZE 64
#define VTX_RECORD_FORMAT 0x03         // HAS_ACCEL (0x01) | HAS_GYRO (0x02)
#define VTX_COMPRESSION_NONE 0
#define VTX_IMU_RECORD_SIZE 28         // 4 (timestamp) + 12 (accel float32x3) + 12 (gyro float32x3)
#define VTX_SYNC_RECORD_SIZE 24        // 4 (t1) + 4 (t4) + 8 (t2) + 8 (t3) — v1.2 clock sync

// ===== BLE Configuration =====
#define BLE_DEVICE_NAME "Vertex-V2"
#define SERVICE_UUID        "12345678-1234-5678-1234-56789abcdef0"
#define SENSOR_CHAR_UUID    "12345678-1234-5678-1234-56789abcdef1"  // Status notifications
#define CONFIG_CHAR_UUID    "12345678-1234-5678-1234-56789abcdef2"  // Commands
#define FILE_LIST_CHAR_UUID "12345678-1234-5678-1234-56789abcdef3"  // File listing
#define FILE_DATA_CHAR_UUID "12345678-1234-5678-1234-56789abcdef4"  // File transfer

// ===== BLE Commands =====
#define CMD_GET_STATUS      0x01  // Query device status (recording, battery, free space)
#define CMD_START_RECORDING 0x02  // Start a new recording session
#define CMD_STOP_RECORDING  0x03  // Stop current recording
#define CMD_LIST_FILES      0x04  // List recorded files on SD
#define CMD_DELETE_FILE     0x06  // Delete a file from SD
#define CMD_SET_WIFI        0x08  // [0x08][SSID\0PASSWORD] — provision WiFi credentials
#define CMD_SYNC_CLOCK      0x09  // Sync wall clock from phone (8 bytes: unix ms int64)
#define CMD_RESET           0x0A  // Soft reset
#define CMD_SET_USER        0x0B  // [0x0B][userId\0apiKey\0serverUrl] — provision user/API credentials
#define CMD_START_SYNC      0x0C  // Trigger WiFi upload of all files
#define CMD_CANCEL_SYNC     0x0D  // Abort current WiFi upload
#define CMD_TIME_RESPONSE   0x0E  // Phone's reply to a periodic time request (16 bytes: t2 int64, t3 int64)
#define CMD_LOG_READ        0x0F  // [0x0F][position uint64] — read diagnostic log from a position
#define CMD_LOG_SET_LEVEL   0x10  // [0x10][level uint8] — set minimum SD log level, persisted in NVS
#define CMD_LOG_STATUS      0x11  // Query log position/level without reading any data
#define CMD_LOG_CLEAR       0x12  // Reset the diagnostic ring to empty

// ===== BLE Notification Opcodes (device → phone, on FILE_LIST characteristic) =====
// Distinguished from file listings by a leading opcode byte. File listings
// never begin with 0xF0 (first byte is a file count <= 255 but the packet is
// only emitted in response to CMD_LIST_FILES).
#define NOTIFY_TIME_REQUEST 0xF0  // [0xF0][t1 uint32] — device asks phone for the time
// [0xF1][next_pos u64][gap u64][total_written u64][min_level u8][len u8][text]
// Reply to CMD_LOG_READ and CMD_LOG_STATUS. `gap` is the number of bytes
// overwritten before this reader saw them — nonzero means the reader lapped
// and the loss is reported rather than silently skipped.
#define NOTIFY_LOG_DATA     0xF1
// Text bytes per notification. The chunk is sized at send time from the
// negotiated MTU (BLEServer::getPeerMTU) rather than fixed: a 180-byte chunk
// against a commonly negotiated 185-517 MTU meant a multi-KB drain took dozens
// of round trips. LOG_BLE_CHUNK_MIN is the floor used when the MTU is
// unavailable or implausibly small (the BLE default is 23), and _MAX bounds
// the stack buffer.
#define LOG_BLE_CHUNK_MIN 180
#define LOG_BLE_CHUNK_MAX 480
// Notification payload = MTU - 3 (ATT opcode + handle). The log preamble is
// 27 bytes ahead of the text.
#define LOG_BLE_PREAMBLE 27

// ===== Hardware Pin Assignments (ESP32-S3 Mini) =====
// Buttons
// BOOT button = GPIO0 (active low, has internal pullup) — used as user button after boot
// RESET button = hard reset (not a GPIO, directly resets the chip)
#define USER_BUTTON_PIN 0

// I2C (LSM6DS3)
#define I2C_SDA_PIN 2
#define I2C_SCL_PIN 1
// Not wired. The FIFO is drained by polling, not by interrupt — see
// notes/firmware-deep-dive.md Module 2e for why (~5,980 ms of FIFO headroom
// against a worst-case loop of tens of ms). Kept so the pin is documented.
#define IMU_INT1_PIN 3

// SPI (SD Card)
#define SD_SCK_PIN  10
#define SD_MOSI_PIN 11
#define SD_MISO_PIN 12
#define SD_CS_PIN   13

// Status LED (WS2812 NeoPixel on ESP32-S3-Zero)
#define LED_PIN 21  // Onboard WS2812 RGB LED

// ===== Battery Configuration =====
// TP4057 outputs raw battery voltage (3.7-4.2V) on BAT+.
// A 100K/100K voltage divider from BAT+ (before Schottky diode) to GPIO4
// halves the voltage into ESP32 ADC range (0-3.3V): 3.7V → 1.85V, 4.2V → 2.1V.
// A Schottky diode (1N5817) is inline on TP4057 OUT+ to ESP32 5V pin to
// prevent USB 5V backfeed into the battery during charging.
// Tap the divider from BAT+ BEFORE the diode to read true battery voltage.
#define BATTERY_ADC_PIN 4              // GPIO4 — 100K/100K divider from BAT+
#define BATTERY_VOLTAGE_DIVIDER 2.0f   // Divider ratio (100K/100K = 2:1)
#define BATTERY_ADC_SAMPLES 8          // Number of ADC reads to average
#define BATTERY_SCALE_FACTOR 1.042f    // Empirical calibration vs multimeter
#define BATTERY_CUTOFF_VOLTAGE 3.2f    // Graceful shutdown threshold (volts)
#define BATTERY_READ_INTERVAL_MS 5000

// ===== IMU Configuration (LSM6DS3) =====
#define IMU_I2C_ADDR 0x6B          // LSM6DS3 with SDO/SA0 high (or floating)
#define IMU_ODR_HZ 104             // Output Data Rate (native 104Hz setting)
#define IMU_ACCEL_RANGE 8          // +/- 8g (sufficient for cycling dynamics)
#define IMU_GYRO_RANGE 1000        // +/- 1000 dps
// Intended FIFO watermark: 60 samples is ~577ms of data at 104Hz, sized as
// headroom against a worst-case loop stall of tens of ms. NOTE: not currently
// referenced by any code — the FIFO runs in continuous mode and readFIFO()
// drains whatever is queued, which in practice is ~1 sample per read.
// Documented intent, not enforced: the FIFO runs in continuous mode and
// loop() drains it unconditionally, so nothing waits for this watermark.
// The headroom argument rests on FIFO depth (682 samples), not this value.
#define IMU_FIFO_THRESHOLD 60

// LSM6DS3 scale factors (raw register value → physical units)
// Accel: at +/-8g range, sensitivity = 0.244 mg/LSB → multiply by 0.000244 * 9.80665 for m/s²
#define ACCEL_SCALE (0.000244f * 9.80665f)  // raw → m/s²
// Gyro: at +/-1000dps range, sensitivity = 35 mdps/LSB → 0.035 deg/s per LSB
#define GYRO_SCALE 0.035f  // raw → deg/s

// ===== SD Card Configuration =====
#define SD_SPI_SPEED 16000000      // 16 MHz SPI clock
#define LOG_DIR "/vtx"             // Directory for log files

// ===== Button Configuration =====
#define BUTTON_DEBOUNCE_MS 50
#define BUTTON_LONG_PRESS_MS 2000  // Long press = shutdown (future)

// ===== Clock Sync Sampling (VTX v1.2) =====
// Every CLOCK_SYNC_INTERVAL_MS of recording, ask the phone for its wall clock
// and store the four-timestamp exchange as a sync record. These are recorded
// as DATA, never applied as a correction — millis() remains the sole time base
// for IMU sample timestamps. See packages/vtx-format/spec/v1.2-clock-sync.md.
#define CLOCK_SYNC_INTERVAL_MS 60000   // Request phone time every 60s while recording
#define CLOCK_SYNC_TIMEOUT_MS 2000     // Give up on a response after 2s; skip the sample
#define MAX_SYNC_RECORDS 512           // RAM buffer: 512 * 24B = 12KB, ~8.5h at 60s cadence

// ===== Diagnostic Log Ring =====
// An on-device diagnostic log in a fixed-size ring file on the same SD card,
// separate from the .vtx recordings. Motivated by the 2026-09-07 ride that
// produced 0 sync records where ~156 were due: the device logged to serial
// only, so the ride carried no evidence of whether it asked and got no answer
// or never asked. See notes/VALIDATION_PLAN.md §C3 and log_ring.h.
#define LOG_FILE_PATH "/vertex.log"    // Outside LOG_DIR: listFiles() enumerates
                                       // /vtx for BLE sync, and the log is not a
                                       // recording. Keeping it out of that
                                       // directory means no filter is needed and
                                       // it can never be offered for upload.
#define LOG_MAGIC "VLOG"               // 4 bytes, no terminator (unlike VTX_MAGIC)
#define LOG_FORMAT_VERSION 1
#define LOG_HEADER_SIZE 32             // Fixed header ahead of the ring region
#define LOG_RING_BYTES (10 * 1024 * 1024)  // 10 MB. At the post-audit line rate
                                       // (~200 B/line, WARN+ plus periodic INFO)
                                       // this holds many rides; see the audit
                                       // table in notes/DIAGNOSTIC_LOG.md.
#define LOG_LINE_MAX 200               // Max formatted line length, excl. newline
#define LOG_BUFFER_BYTES 2048          // RAM staging buffer (see flush policy)
// Time-based flush. Two intervals, because the right answer depends on whether
// anyone is looking:
//
//   IDLE   — nothing is reading, so the only job is bounding what a crash
//            loses. 30 s is plenty and keeps SD writes rare on a long ride.
//   ACTIVE — a reader has pulled the log recently, so buffered lines are lag
//            the user can see. At INFO the buffer takes ~37 min to reach half
//            capacity, which means the timer is ALWAYS what flushes and every
//            event sat up to 30 s before becoming visible.
//
// Cost of the 1 s interval, arithmetic from SD_SPI_SPEED: ~250 B per flush =
// 0.13 ms pure SPI, 2.5 ms even at a 20x pessimistic multiplier for sector and
// FAT overhead. That is a 0.25% duty cycle and ~2,373x margin against the
// ~5,980 ms FIFO headroom — and a smaller transaction than the .vtx header
// patch already running every 10 s.
#define LOG_FLUSH_INTERVAL_MS 30000        // no reader attached
#define LOG_FLUSH_INTERVAL_ACTIVE_MS 1000  // reader pulled within the window below
// How long a reader stays "active" after its last pull. Long enough to cover
// the gap between app refreshes, short enough that a closed app drops back to
// the idle cadence on its own.
#define LOG_READER_ACTIVE_MS 15000
// Flush on whichever comes first: a WARN-or-above record (these are exactly
// the lines that precede the crash being diagnosed, so a timer that loses the
// last 30 s loses the interesting content), the buffer reaching half capacity,
// or LOG_FLUSH_INTERVAL_MS elapsing.
#define LOG_FLUSH_LEVEL LOG_WARN
// INFO is the floor, not a default to be raised. Measured volume over a 3 h
// ride: ~300 INFO lines ≈ 18 KB, so the 10 MB ring holds hundreds of rides —
// there is no capacity argument for recording less, and a level that hides
// "recording started" defeats the point of having a log. DEBUG is the only
// tier that scales with loop rate (~2.3 MB over the same 3 h, wrapping the
// ring in ~13 h), so it is the only one worth gating.
#define LOG_DEFAULT_MIN_LEVEL LOG_INFO
// The most restrictive _minLevel the device will accept. Levels are ordered
// DEBUG(0) < INFO(1) < WARN(2) < ERROR(3) and the filter is `level >=
// _minLevel`, so a HIGHER _minLevel records LESS. Capping it at INFO
// guarantees INFO and above are always captured; the only remaining choice is
// whether DEBUG (0) is included.
#define LOG_MAX_MIN_LEVEL LOG_INFO

// The 2 Hz idle IMU sample dump, off by default. It is a bench tool for
// axis/orientation work with a serial monitor attached, not a field
// diagnostic: left on it emits ~95% of all ring lines and laps the 10 MB ring
// fast enough to destroy the history of whatever is actually being
// investigated. Routine IMU health is covered by the one-line "IMU healthy"
// record at boot plus the existing FAULT paths.
//
// Compile-time rather than runtime so the BLE DEBUG toggle cannot enable it by
// accident — DEBUG is meant to add event detail, not a sample firehose.
#define IMU_IDLE_SAMPLE_DUMP 0

// The staging buffer must hold at least two maximum-length lines, or the
// half-capacity flush trigger fires on every single record and the buffer
// stops being a buffer.
static_assert(LOG_BUFFER_BYTES >= 2 * (LOG_LINE_MAX + 1),
              "LOG_BUFFER_BYTES must hold at least two full lines");

// ===== Timing =====
#define LED_BLINK_IDLE 2000        // Slow blink when idle
#define LED_BLINK_RECORDING 500    // Medium blink when recording
#define LED_BLINK_UPLOADING 100    // Fast blink when uploading via WiFi
// ── Storage capacity policy ────────────────────────────────────────────────
// Fill rate is exactly known: 28 B/record x 104 Hz = 2912 B/s = 10.0 MB/hour.
// That makes remaining capacity a predictable resource — report time left,
// not just bytes left.
#define SD_BYTES_PER_SECOND (VTX_IMU_RECORD_SIZE * IMU_ODR_HZ)  // 2912 B/s
#define SD_MIN_START_MB 60         // refuse to start below ~6 h of headroom
#define SD_WARN_MB 120             // ~12 h — surfaced to the app as a warning
#define SD_CRITICAL_MB 20          // ~2 h — stop cleanly at this point

// The two thresholds must not invert. startRecording() gates on
// SD_MIN_START_MB; the recording loop gates on SD_CRITICAL_MB. If critical
// were the larger of the two, every start would open a file, stop before the
// first write, and cleanly close a 0-record .vtx — exactly the silent failure
// the start guard exists to prevent. Found at the bench 2026-09-06 while
// raising SD_CRITICAL_MB to make the stop path reachable.
static_assert(SD_CRITICAL_MB < SD_MIN_START_MB,
              "SD_CRITICAL_MB must be below SD_MIN_START_MB, or every "
              "recording starts and immediately closes empty");
// While recording, free space is PREDICTED from elapsed time at the known
// fill rate rather than measured — nothing else writes to the card mid-ride,
// and SD.usedBytes() walks the FAT (tens of ms on a large card). The
// prediction drifts optimistic because it ignores FAT cluster and directory
// overhead, so it is reconciled against a real read on this interval.
#define SD_SPACE_RECONCILE_MS 600000   // 10 min
#define LED_BLINK_FAULT 150        // Urgent blink, red, when a critical
                                   // subsystem failed init

// ===== WiFi Upload Configuration =====
#define WIFI_CONNECT_TIMEOUT_MS 10000  // 10s to connect to WiFi
// Read SD in 8KB chunks for HTTP upload. Was 16384, briefly 4096.
//
// 16384 also equalled CONFIG_MBEDTLS_SSL_MAX_CONTENT_LEN, so every chunk had
// to fill a whole TLS record. More importantly, a single blocking write() of
// one chunk can hold loop() for the socket send timeout — measured at
// 30,003 ms against a 5 s task watchdog, which is exactly the freeze-then-
// reboot seen on 2026-09-12. A smaller chunk bounds how much is in flight per
// call; WIFI_WRITE_TIMEOUT_MS bounds the time.
//
// A tempting theory held that the fix was fitting under lwIP's TCP send buffer
// (CONFIG_LWIP_TCP_SND_BUF_DEFAULT = 5744 B, 4 x MSS), since a write() larger
// than that cannot complete without blocking for ACKs. The 2026-09-13
// measurement below does not support it: 8192 is 1.43x the send buffer and
// stalled zero times across 42 MB. The theory explains why a stall is
// POSSIBLE, not why stalls became persistent on 2026-09-12 — that remains
// unexplained, and the retry path is what actually contains it.
//
// 8192 is half a TLS record: large enough to keep throughput up, small enough
// that no single write ever has to fill a complete record before it can drain.
//
// Both sizes were measured against the same 42,341,515-byte file on
// 2026-09-13, back to back on the same network:
//
//   8192: 624.7 s, 66.2 KiB/s, 0 EAGAIN retries across 5,168 writes
//   4096: 607.9 s, 68.0 KiB/s
//
// The 2.7% difference is inside run-to-run variance (RSSI swung -74..-54 dBm
// within a single run), and the two figures are measured slightly differently
// — device-side presign->PUT-complete vs server-side key-epoch->stored — so
// the honest conclusion is that chunk size does not move throughput here. The
// bottleneck is upstream (TLS, link, or server), not chunking.
//
// 8192 therefore wins on syscall overhead: 5,168 writes for this file rather
// than 10,337, for the same wall time.
//
// Note this refutes the tidy send-buffer story: 8192 is 1.43x
// CONFIG_LWIP_TCP_SND_BUF_DEFAULT (5,744 B), so every write should have had to
// block for ACKs — yet it stalled zero times across 42 MB. Whatever made
// writes stop draining on 2026-09-12 was not simply "chunk exceeds send
// buffer". WIFI_WRITE_MAX_RETRIES is what actually buys reliability here; it
// costs nothing when unused and turns that unexplained stall from a watchdog
// reboot into a survivable pause.
#define WIFI_UPLOAD_CHUNK_SIZE 8192
// Socket send timeout. WiFiClientSecure defaults to 30000 ms, which is six
// times the task watchdog — a stalled peer therefore reboots the device rather
// than failing the upload. Fail fast instead and let the sync state machine
// report a clean error.
// Kept below the 5 s task watchdog with margin. The streaming loop can issue
// several writes per tick(), so the budget check in WIFI_STREAMING is what
// bounds a tick overall — this bounds any single write.
#define WIFI_WRITE_TIMEOUT_MS 2000
// Consecutive EAGAIN retries tolerated on one chunk before the upload is
// abandoned. At WIFI_WRITE_TIMEOUT_MS each, this is the longest the transfer
// will wait for the peer's receive window to reopen (60 x 2 s = 2 min), with
// loop() serviced between every attempt so the watchdog is fed.
#define WIFI_WRITE_MAX_RETRIES 60
#define WIFI_STREAM_BUDGET_MS 100     // Max ms to spend streaming per tick() before yielding

// ===== CPU Frequency =====
#define CPU_MHZ_NORMAL 80          // 80MHz for recording/idle (saves ~32mA vs 240MHz)
#define CPU_MHZ_WIFI 240           // 240MHz required for WiFi

// ===== I2C Configuration =====
#define I2C_CLOCK_SPEED 400000     // 400kHz fast mode

// ===== Device State =====
enum DeviceState : int {
  STATE_IDLE,       // Waiting — BLE advertising, not recording
  STATE_RECORDING,  // Active recording — FIFO reads + SD writes
  STATE_UPLOADING,  // WiFi upload in progress
  STATE_FAULT,      // IMU or SD failed at init — recording is refused
};

#endif // CONFIG_H
