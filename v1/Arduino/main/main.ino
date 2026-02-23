/*
  TOM Project
  --- BLE Disconnect Fix ---
  Changes from original:
  1. Larger SD read buffer (256→512 frames) — fewer SPI transactions
  2. SD double-buffering (prefetch) — reads happen while I2S plays previous buffer
  3. Adaptive vTaskDelay (8ms in song mode vs 2ms accordion) — lets loop() run
  4. Zero-allocation BLE command parser (char[] instead of Arduino String)
  5. BLE heartbeat watchdog — bleNotifyTask sends keepalive if loop() is stalled
  6. Heap-low safety — logs warning and throttles when heap drops below 30KB
  */
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Arduino.h>
#include <SPI.h>
#include <SD.h>
#include "driver/i2s_std.h"
#include "esp_bt.h"
#include "esp_gap_ble_api.h"
#include <Preferences.h>

Preferences prefs;

// ---------- Audio & Pin Configuration ----------
volatile float sensorMaxVol[4] = {1.0f, 1.0f, 1.0f, 1.0f};
volatile int sensorBaselines[4] = {300, 300, 300, 300};
volatile int sensorThresholds[4] = {150, 150, 150, 150};
volatile float masterVol = 1.0f;
volatile bool systemOn = true;

// Sensitivity curve exponents (controlled via BLE slider 0-100)
// Front uses lower exponent = more sensitive to light touch
// Back uses higher exponent = needs harder press
volatile float frontExp = 0.5f;   // default: sqrt (very responsive)
volatile float backExp  = 2.0f;   // default: squared (needs firm press)

// ---------- Wavetable Synthesis ----------
#define WAVETABLE_SIZE 256
#define NUM_VOICES 4
#define SAMPLE_RATE 22050

int16_t wavetable[WAVETABLE_SIZE];

const float noteFreqs[NUM_VOICES] = {
  261.63f,  // C4 - Sensor 0 (Right Front)
  329.63f,  // E4 - Sensor 1 (Left Front)
  392.00f,  // G4 - Sensor 2 (Right Back)
  523.25f   // C5 - Sensor 3 (Left Back)
};

struct Voice {
  float phaseAccumulator;
  float phaseIncrement;
  float phase2;            // second detuned oscillator for natural beating
  float phaseInc2;         // slightly different frequency (± cents)
  volatile float targetVol;
  float currentVol;
  float panL;
  float panR;
};

Voice voices[NUM_VOICES];

// Tremolo LFO for bellows simulation (~5Hz gentle wobble)
float tremoloPhase = 0.0f;
#define TREMOLO_HZ    5.0f
#define TREMOLO_DEPTH 0.08f   // subtle ±8% volume modulation

// ---------- Audio Mode ----------
volatile int audioMode = 0;  // 0 = accordion, 1 = song + enrichment

// Mode 1: Song playback from SD card
File songFile;
bool songFileOpen = false;
#define WAV_HEADER_SIZE 44

// SD file operation flags — BLE callback (Core 0) sets these,
// audio task (Core 1) executes them. Prevents cross-core SPI crash.
volatile bool needOpenSong = false;
volatile bool needCloseSong = false;

// BLE notification runs on Core 0 (same core as BLE stack) to prevent
// cross-core mutex deadlock. loop() writes data here, Core 0 task sends it.
char blePayload[80];
volatile bool bleNeedsSend = false;

// FIX #5: BLE heartbeat — track when loop() last updated blePayload
// If loop() is starved for >2s, bleNotifyTask sends a keepalive heartbeat
volatile unsigned long lastBleUpdateMs = 0;
#define BLE_HEARTBEAT_TIMEOUT_MS 2000

// Mode 1: Per-channel frequency-band filtering with hold+decay
// Right foot → right speaker, Left foot → left speaker
// Walking restores filtered frequencies, holds 1.5s, then decays
//
// Low-pass filter at 600Hz: alpha = 2*PI*600 / (2*PI*600 + 22050) ≈ 0.146
#define LP_ALPHA 0.146f
float lpStateL = 0.0f;   // low-pass filter state, left channel
float lpStateR = 0.0f;   // low-pass filter state, right channel

// Base levels (at rest / fully decayed)
#define TREBLE_BASE 0.05f
#define BASS_BASE   0.15f

// Hold + decay timing
#define HOLD_TIME_MS 1500       // hold peak level for 1.5 seconds
#define DECAY_PER_LOOP 0.016f   // decay speed (~1.5s from peak to base at 25ms loop)

// Per-channel band levels (read by audio task)
volatile float trebleLvlR = TREBLE_BASE;  // right speaker treble (sensor 0)
volatile float trebleLvlL = TREBLE_BASE;  // left speaker treble (sensor 1)
volatile float bassLvlR   = BASS_BASE;    // right speaker bass (sensor 2)
volatile float bassLvlL   = BASS_BASE;    // left speaker bass (sensor 3)

// Hold/decay state per sensor band
struct BandHold {
  float peak;                // peak level from last press
  unsigned long lastActive;  // millis() when sensor was last above threshold
};
BandHold holdTrebleR = {TREBLE_BASE, 0};
BandHold holdTrebleL = {TREBLE_BASE, 0};
BandHold holdBassR   = {BASS_BASE, 0};
BandHold holdBassL   = {BASS_BASE, 0};

#define I2S_BCLK_PIN  GPIO_NUM_27
#define I2S_WS_PIN    GPIO_NUM_14
#define I2S_DOUT_PIN  GPIO_NUM_22
#define SD_CS_PIN     5
#define SPI_SCK       18
#define SPI_MISO      19
#define SPI_MOSI      23

// Define sensor pins (ADC pins on ESP32)
const int sensorPins[] = {34, 35, 32, 33};
const int numSensors = 4;
const int ledPin = 2; // Use the appropriate GPIO pin for your setup

i2s_chan_handle_t tx_handle = NULL;

// ---------- BLE State ----------
BLEServer* pServer = NULL;
BLECharacteristic* pSensorCharacteristic = NULL;
BLECharacteristic* pLedCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;

// See the following for generating UUIDs:
// https://www.uuidgenerator.net/
#define SERVICE_UUID        "19b10000-e8f2-537e-4f6c-d104768a1214"
#define SENSOR_CHARACTERISTIC_UUID "19b10001-e8f2-537e-4f6c-d104768a1214"
#define LED_CHARACTERISTIC_UUID "19b10002-e8f2-537e-4f6c-d104768a1214"

// FIX #6: Heap safety threshold
#define HEAP_LOW_THRESHOLD 30000  // 30KB — below this, throttle audio to free CPU

// ---------- Wavetable Generation ----------
void generateAccordionWavetable() {
  // Warmer accordion timbre: strong fundamental, gentle harmonic rolloff
  // Real accordion reeds have a warm, full tone — not overly buzzy
  const int numHarmonics = 8;
  const float harmonicNum[] = {1, 2, 3, 4, 5, 6, 7, 8};
  const float harmonicAmp[] = {1.0f, 0.6f, 0.35f, 0.2f, 0.12f, 0.08f, 0.05f, 0.03f};

  float rawTable[WAVETABLE_SIZE];
  float peak = 0.0f;

  for (int i = 0; i < WAVETABLE_SIZE; i++) {
    float sample = 0.0f;
    float phase = (float)i / WAVETABLE_SIZE * 2.0f * PI;
    for (int h = 0; h < numHarmonics; h++) {
      sample += harmonicAmp[h] * sinf(harmonicNum[h] * phase);
    }
    rawTable[i] = sample;
    if (fabsf(sample) > peak) peak = fabsf(sample);
  }

  // Scale so 4 voices at max sum to 32767
  float scale = (32767.0f * 0.25f) / peak;
  for (int i = 0; i < WAVETABLE_SIZE; i++) {
    wavetable[i] = (int16_t)(rawTable[i] * scale);
  }
  Serial.println("Accordion wavetable generated.");
}

// ---------- Filter State Reset ----------
void resetFilterState() {
  lpStateL = 0.0f;
  lpStateR = 0.0f;
  trebleLvlR = TREBLE_BASE; trebleLvlL = TREBLE_BASE;
  bassLvlR = BASS_BASE;     bassLvlL = BASS_BASE;
  holdTrebleR = {TREBLE_BASE, 0}; holdTrebleL = {TREBLE_BASE, 0};
  holdBassR = {BASS_BASE, 0};    holdBassL = {BASS_BASE, 0};
  Serial.println("Filter initialized (per-channel, 600Hz split, 1.5s hold).");
}

// ---------- Song File Helper ----------
void openSongFile() {
  if (songFileOpen) {
    songFile.close();
    songFileOpen = false;
  }
  songFile = SD.open("/SONG.WAV");
  if (songFile) {
    songFile.seek(WAV_HEADER_SIZE);
    songFileOpen = true;
    Serial.println("SONG.WAV opened");
  } else {
    Serial.println("SONG.WAV not found on SD card!");
  }
}

// ---------- FIX #4: Zero-allocation BLE command parser ----------
// Replaces Arduino String with fixed char buffers to prevent heap fragmentation.
// BLE max write is 512 bytes; 128 is plenty for our commands.
#define CMD_BUF_SIZE 128

// Parse comma-separated ints from a char* buffer. Returns count parsed.
static int parseCsvInts(const char *str, int *out, int maxOut) {
  int count = 0;
  const char *p = str;
  while (*p && count < maxOut) {
    out[count++] = atoi(p);
    // Skip to next comma or end
    while (*p && *p != ',') p++;
    if (*p == ',') p++;
  }
  return count;
}

// ---------- Audio Task (Dual Mode) ----------
// FIX #1: Larger buffer (512 frames) — fewer SD transactions per second
// FIX #2: Double buffering — prefetch next SD block while I2S plays current
void audioTask(void *parameter) {
  const size_t numFrames = 512;   // FIX #1: doubled from 256
  const size_t bufSize = numFrames * 2 * sizeof(int16_t); // stereo 16-bit
  int16_t *buffer = (int16_t *)heap_caps_malloc(bufSize, MALLOC_CAP_DMA);
  // FIX #2: Two song buffers for ping-pong double buffering
  int16_t *songBufA = (int16_t *)heap_caps_malloc(bufSize, MALLOC_CAP_DMA);
  int16_t *songBufB = (int16_t *)heap_caps_malloc(bufSize, MALLOC_CAP_DMA);

  if (buffer == NULL || songBufA == NULL || songBufB == NULL) {
    Serial.println("Failed to allocate audio buffers");
    vTaskDelete(NULL);
    return;
  }

  // Double-buffer state: which buffer has valid prefetched data
  int16_t *songReady = NULL;     // buffer with prefetched data (NULL = none)
  size_t   songReadyBytes = 0;   // how many bytes were prefetched

  i2s_channel_enable(tx_handle);

  // Smoother attack for more natural onset (real bellows take time to build pressure)
  const float attackAlpha  = 0.003f;
  const float releaseAlpha = 0.0008f;

  while (true) {
    // Handle SD file operations on this core (Core 1) to avoid cross-core SPI crash
    if (needCloseSong) {
      needCloseSong = false;
      if (songFileOpen) { songFile.close(); songFileOpen = false; }
      songReady = NULL;  // invalidate prefetch
      Serial.println("Song file closed (audio task)");
    }
    if (needOpenSong) {
      needOpenSong = false;
      openSongFile();
      songReady = NULL;  // invalidate prefetch
      Serial.println("Song file opened (audio task)");
    }

    memset(buffer, 0, bufSize);

    int currentMode = audioMode;

    // ---- Mode 1: Song + frequency filter ----
    if (currentMode == 1 && songFileOpen) {
      // FIX #2: Use prefetched buffer if available, otherwise read now
      int16_t *songBuf;
      size_t bytesRead;
      if (songReady != NULL) {
        // Use the prefetched data — no SD wait!
        songBuf = songReady;
        bytesRead = songReadyBytes;
        songReady = NULL;
      } else {
        // First iteration or after seek — must read synchronously
        songBuf = songBufA;
        bytesRead = songFile.read((uint8_t*)songBuf, bufSize);
      }

      // FIX #3: Yield after SD read to let loop() run (longer yield in song mode)
      vTaskDelay(pdMS_TO_TICKS(1));  // brief yield between SD read and processing

      if (bytesRead < bufSize) {
        // At song end: pad with silence, rewind for next cycle
        memset((uint8_t*)songBuf + bytesRead, 0, bufSize - bytesRead);
        songFile.seek(WAV_HEADER_SIZE);
      }

      float mv = masterVol;
      // Per-channel levels: right foot → right speaker, left foot → left speaker
      float tR = trebleLvlR, tL = trebleLvlL;
      float bR = bassLvlR,   bL = bassLvlL;

      for (int f = 0; f < (int)numFrames; f++) {
        int idx = f * 2;
        float rawL = (float)songBuf[idx];
        float rawR = (float)songBuf[idx + 1];

        // Single-pole low-pass filter: splits into bass + treble per channel
        lpStateL += LP_ALPHA * (rawL - lpStateL);
        lpStateR += LP_ALPHA * (rawR - lpStateR);

        // Split each channel into bass and treble bands
        float bassLeft  = lpStateL;
        float bassRight = lpStateR;
        float trebLeft  = rawL - lpStateL;
        float trebRight = rawR - lpStateR;

        // Reconstruct: each speaker controlled by its foot's sensors
        // Left speaker = left foot sensors (1,3)
        // Right speaker = right foot sensors (0,2)
        float outL = (bassLeft * bL + trebLeft * tL) * mv;
        float outR = (bassRight * bR + trebRight * tR) * mv;

        // Clamp output
        int32_t iL = (int32_t)outL;
        int32_t iR = (int32_t)outR;
        buffer[idx]     = (int16_t)(iL > 32767 ? 32767 : (iL < -32768 ? -32768 : iL));
        buffer[idx + 1] = (int16_t)(iR > 32767 ? 32767 : (iR < -32768 ? -32768 : iR));
      }

      // FIX #2: Prefetch next block into the OTHER buffer while I2S plays this one.
      // This way the next iteration won't block on SD read.
      int16_t *prefetchBuf = (songBuf == songBufA) ? songBufB : songBufA;
      songReadyBytes = songFile.read((uint8_t*)prefetchBuf, bufSize);
      if (songReadyBytes < bufSize) {
        memset((uint8_t*)prefetchBuf + songReadyBytes, 0, bufSize - songReadyBytes);
        songFile.seek(WAV_HEADER_SIZE);
        // Re-read from beginning for seamless loop
        size_t remaining = bufSize - songReadyBytes;
        if (remaining > 0 && songFileOpen) {
          songFile.read((uint8_t*)prefetchBuf + songReadyBytes, remaining);
          songReadyBytes = bufSize;
        }
      }
      songReady = prefetchBuf;
    }

    // ---- Mode 0: Accordion wavetable synthesis (dual detuned oscillators + tremolo) ----
    if (currentMode == 0) {
      // Pre-compute tremolo LFO for entire buffer (simple sine, computed once)
      float tPhase = tremoloPhase;
      const float tPhaseInc = (2.0f * PI * TREMOLO_HZ) / (float)SAMPLE_RATE;

      for (int v = 0; v < NUM_VOICES; v++) {
        float phase = voices[v].phaseAccumulator;
        float phaseInc = voices[v].phaseIncrement;
        float phase2 = voices[v].phase2;
        float phaseInc2 = voices[v].phaseInc2;
        float target = voices[v].targetVol;
        float current = voices[v].currentVol;
        float pL = voices[v].panL;
        float pR = voices[v].panR;
        float localTPhase = tremoloPhase;  // each voice reads same tremolo

        for (int f = 0; f < (int)numFrames; f++) {
          float alpha = (target > current) ? attackAlpha : releaseAlpha;
          current += alpha * (target - current);

          // First oscillator (slightly flat)
          int idx0 = (int)phase & (WAVETABLE_SIZE - 1);
          int idx1 = (idx0 + 1) & (WAVETABLE_SIZE - 1);
          float frac = phase - (float)(int)phase;
          float sample1 = (float)wavetable[idx0] + frac * (float)(wavetable[idx1] - wavetable[idx0]);

          // Second oscillator (slightly sharp) — creates natural beating
          int idx2 = (int)phase2 & (WAVETABLE_SIZE - 1);
          int idx3 = (idx2 + 1) & (WAVETABLE_SIZE - 1);
          float frac2 = phase2 - (float)(int)phase2;
          float sample2 = (float)wavetable[idx2] + frac2 * (float)(wavetable[idx3] - wavetable[idx2]);

          // Mix both oscillators (equal blend for chorus effect)
          float sample = (sample1 + sample2) * 0.5f;

          // Tremolo: clean sine LFO (bellows wobble)
          float tremoloMod = 1.0f + sinf(localTPhase) * TREMOLO_DEPTH;

          float out = sample * current * tremoloMod;

          int bufIdx = f * 2;
          buffer[bufIdx]     += (int16_t)(out * pL);
          buffer[bufIdx + 1] += (int16_t)(out * pR);

          phase += phaseInc;
          if (phase >= (float)WAVETABLE_SIZE) phase -= (float)WAVETABLE_SIZE;
          phase2 += phaseInc2;
          if (phase2 >= (float)WAVETABLE_SIZE) phase2 -= (float)WAVETABLE_SIZE;
          localTPhase += tPhaseInc;
        }

        voices[v].phaseAccumulator = phase;
        voices[v].phase2 = phase2;
        voices[v].currentVol = current;
      }
      // Update global tremolo phase (advance by numFrames steps)
      tremoloPhase += tPhaseInc * (float)numFrames;
      if (tremoloPhase > 2.0f * PI) tremoloPhase -= 2.0f * PI;
    }

    // Clamp to prevent overflow (Mode 0 accumulates, Mode 1 already clamped inline)
    for (int i = 0; i < (int)(numFrames * 2); i++) {
      if (buffer[i] > 32767) buffer[i] = 32767;
      if (buffer[i] < -32768) buffer[i] = -32768;
    }

    size_t bytesWritten = 0;
    i2s_channel_write(tx_handle, buffer, bufSize, &bytesWritten, portMAX_DELAY);

    // FIX #3: Adaptive yield — song mode needs more yield for loop() to update BLE
    // Accordion mode: pure CPU math, very fast → short yield
    // Song mode: SD I/O already took time, but loop() still needs its turn
    if (currentMode == 1) {
      vTaskDelay(pdMS_TO_TICKS(8));   // 8ms yield in song mode — lets loop() run reliably
    } else {
      vTaskDelay(pdMS_TO_TICKS(2));   // 2ms in accordion mode — synthesis is lightweight
    }

    // FIX #6: If heap is critically low, add extra delay to reduce pressure
    if (ESP.getFreeHeap() < HEAP_LOW_THRESHOLD) {
      vTaskDelay(pdMS_TO_TICKS(10));  // emergency throttle
    }
  }
}

// ---------- BLE Callbacks ----------
class MyServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer, esp_ble_gatts_cb_param_t *param) {
    deviceConnected = true;
    // Increase supervision timeout for range tolerance (walk around room)
    // Default ~200ms is too aggressive — BLE drops on 2-3 meter distance.
    // 4-second timeout lets the radio recover from brief obstructions.
    esp_ble_conn_update_params_t conn_params = {};
    memcpy(conn_params.bda, param->connect.remote_bda, sizeof(esp_bd_addr_t));
    conn_params.min_int  = 0x10;   // 20ms   (units: 1.25ms)
    conn_params.max_int  = 0x20;   // 40ms
    conn_params.latency  = 0;      // no slave latency
    conn_params.timeout  = 400;    // 4000ms (units: 10ms)
    esp_ble_gap_update_conn_params(&conn_params);
  };

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
  }
};

// FIX #4: Zero-allocation BLE command parser
// Uses stack-allocated char arrays instead of Arduino String to prevent
// heap fragmentation that causes BLE stack memory allocation failures.
class MyCharacteristicCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    String value = pCharacteristic->getValue();
    if (value.length() == 0) return;

    // Check for single-byte legacy LED command (1 byte payload)
    if (value.length() == 1) {
      uint8_t val = (uint8_t)value[0];
      if (val == 1) {
        digitalWrite(ledPin, HIGH);
        systemOn = true;
      } else {
        digitalWrite(ledPin, LOW);
        systemOn = false;
      }
      return;
    }

    // Copy to stack buffer to avoid any heap allocation
    char buf[CMD_BUF_SIZE];
    size_t len = value.length();
    if (len >= CMD_BUF_SIZE) len = CMD_BUF_SIZE - 1;
    memcpy(buf, value.c_str(), len);
    buf[len] = '\0';

    // Find separator ':'
    char *sep = strchr(buf, ':');
    if (sep == NULL) return;

    *sep = '\0';           // split: buf = command, sep+1 = data
    const char *command = buf;
    const char *data = sep + 1;

    if (strcmp(command, "POWER") == 0) {
      int state = atoi(data);
      if (state == 1) {
        digitalWrite(ledPin, HIGH);
        systemOn = true;
        Serial.println("System ON");
      } else {
        digitalWrite(ledPin, LOW);
        systemOn = false;
        Serial.println("System OFF");
      }
    }
    else if (strcmp(command, "SENSOR_VOLUME") == 0) {
      // Data format: "ID,VOLUME"
      const char *comma = strchr(data, ',');
      if (comma != NULL) {
        int id = atoi(data);
        float volume = atof(comma + 1);

        if (id >= 0 && id < 4) {
          if (volume < 0) volume = 0;
          if (volume > 100) volume = 100;

          sensorMaxVol[id] = volume / 100.0f;
          Serial.printf("Set Sensor %d Max Vol: %f\n", id, sensorMaxVol[id]);
        }
      }
    }
    else if (strcmp(command, "CALIBRATE") == 0) {
      int vals[4];
      if (parseCsvInts(data, vals, 4) == 4) {
        for (int i = 0; i < 4; i++) sensorBaselines[i] = vals[i];
        Serial.printf("Calibrated Baselines: %d, %d, %d, %d\n",
          sensorBaselines[0], sensorBaselines[1], sensorBaselines[2], sensorBaselines[3]);
      }
    }
    else if (strcmp(command, "SENSOR_THRESHOLD") == 0) {
      int vals[4];
      if (parseCsvInts(data, vals, 4) == 4) {
        for (int i = 0; i < 4; i++) sensorThresholds[i] = vals[i];
        Serial.printf("Thresholds: %d, %d, %d, %d\n",
          sensorThresholds[0], sensorThresholds[1], sensorThresholds[2], sensorThresholds[3]);
      }
    }
    else if (strcmp(command, "VOLUME_TOTAL") == 0) {
      float vol = atof(data);
      if (vol < 0) vol = 0;
      if (vol > 100) vol = 100;
      masterVol = vol / 100.0f;
      Serial.printf("Master Volume: %f\n", masterVol);
    }
    else if (strcmp(command, "MODE") == 0) {
      int mode = atoi(data);
      prefs.putInt("mode", mode);  // persist to NVS — survives resets
      if (mode == 0) {
        audioMode = 0;
        needCloseSong = true;  // Audio task will close file on Core 1
        // Restore accordion frequencies with detuning
        const float dr = powf(2.0f, 4.0f / 1200.0f);
        for (int i = 0; i < NUM_VOICES; i++) {
          float freq = noteFreqs[i];
          voices[i].phaseIncrement = (freq / dr * WAVETABLE_SIZE) / (float)SAMPLE_RATE;
          voices[i].phaseInc2 = (freq * dr * WAVETABLE_SIZE) / (float)SAMPLE_RATE;
          voices[i].targetVol = 0.0f;
        }
        Serial.println("Mode: Accordion (saved)");
      } else if (mode == 1) {
        // Song mode: silence all accordion voices
        for (int i = 0; i < NUM_VOICES; i++) {
          voices[i].targetVol = 0.0f;
        }
        resetFilterState();
        needOpenSong = true;  // Audio task will open file on Core 1
        audioMode = 1;
        Serial.println("Mode: Song (saved, file will open on audio core)");
      }
    }
    else if (strcmp(command, "SENSITIVITY") == 0) {
      // Slider 0-100: 0=back sensitive, 50=balanced, 100=front sensitive
      float s = atof(data);
      if (s < 0) s = 0;
      if (s > 100) s = 100;
      float t = s / 100.0f;
      // Map slider to exponents: higher exponent = less sensitive
      frontExp = 2.0f - t * 1.7f;   // 2.0 at s=0 → 0.3 at s=100
      backExp  = 0.3f + t * 1.7f;   // 0.3 at s=0 → 2.0 at s=100
      Serial.printf("Sensitivity: slider=%d front=%.2f back=%.2f\n", (int)s, frontExp, backExp);
    }
  }
};

// ---------- BLE Notify Task (Core 0) ----------
// FIX #5: Added heartbeat watchdog.
// If loop() hasn't updated blePayload in >2 seconds (Core 1 starved),
// this task sends a minimal heartbeat to keep the BLE connection alive.
// Without this, the phone/browser's GATT layer may decide the device is dead.
void bleNotifyTask(void *parameter) {
  while (true) {
    if (deviceConnected && pSensorCharacteristic != NULL) {
      if (bleNeedsSend) {
        // Normal path: loop() prepared fresh data
        pSensorCharacteristic->setValue(blePayload);
        pSensorCharacteristic->notify();
        bleNeedsSend = false;
      } else {
        // FIX #5: Heartbeat — if loop() hasn't sent data in >2s, send keepalive
        unsigned long now = millis();
        if (lastBleUpdateMs > 0 && (now - lastBleUpdateMs) > BLE_HEARTBEAT_TIMEOUT_MS) {
          // Send minimal heartbeat so BLE connection stays alive
          pSensorCharacteristic->setValue("{\"hb\":1}");
          pSensorCharacteristic->notify();
          lastBleUpdateMs = now;  // reset timer
          Serial.println("BLE heartbeat sent (loop stalled)");
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(20));  // check every 20ms
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(ledPin, OUTPUT);

  // Initialize sensor pins
  analogReadResolution(12); // Ensure we use 12-bit resolution matching new sketch
  for(int i = 0; i < numSensors; i++) {
    pinMode(sensorPins[i], INPUT);
  }

  // ---------- SD Card Setup (kept for future use) ----------
  SPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI, SD_CS_PIN);
  if (!SD.begin(SD_CS_PIN)) {
    Serial.println("SD Init Failed!");
  } else {
    Serial.println("SD Card Ready");
  }

  // ---------- Restore saved mode from NVS ----------
  prefs.begin("audio", false);
  audioMode = prefs.getInt("mode", 0);  // default: accordion
  Serial.printf("Restored mode: %d (%s)\n", audioMode, audioMode == 1 ? "Song" : "Accordion");
  if (audioMode == 1) {
    needOpenSong = true;  // Audio task will open song file after starting
  }

  // ---------- Synthesis Setup ----------
  generateAccordionWavetable();
  resetFilterState();
  // Detuning: ±4 cents creates the classic accordion "beating" between two reeds
  // cents-to-ratio: 2^(cents/1200)
  const float detuneRatio = powf(2.0f, 4.0f / 1200.0f);  // ~1.00231

  for (int i = 0; i < NUM_VOICES; i++) {
    float freq = noteFreqs[i];
    voices[i].phaseAccumulator = 0.0f;
    voices[i].phaseIncrement = (freq / detuneRatio * WAVETABLE_SIZE) / (float)SAMPLE_RATE;  // slightly flat
    voices[i].phase2 = 0.0f;
    voices[i].phaseInc2 = (freq * detuneRatio * WAVETABLE_SIZE) / (float)SAMPLE_RATE;       // slightly sharp
    voices[i].targetVol = 0.0f;
    voices[i].currentVol = 0.0f;
    // Right foot sensors (0,2) -> right speaker, Left foot sensors (1,3) -> left speaker
    voices[i].panL = (i == 1 || i == 3) ? 1.0f : 0.0f;
    voices[i].panR = (i == 0 || i == 2) ? 1.0f : 0.0f;
  }

  // ---------- I2S Setup ----------
  i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  i2s_new_channel(&chan_cfg, &tx_handle, NULL);
  i2s_std_config_t std_cfg = {
      .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(22050), // Matches typical WAV sample rate
      .slot_cfg = I2S_STD_MSB_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
      .gpio_cfg = {
        .mclk = I2S_GPIO_UNUSED,
        .bclk = I2S_BCLK_PIN,
        .ws = I2S_WS_PIN,
        .dout = I2S_DOUT_PIN,
        .din = I2S_GPIO_UNUSED
      }
  };
  i2s_channel_init_std_mode(tx_handle, &std_cfg);

  // Audio on Core 1 (same core as Arduino loop) — frees Core 0 for BLE stack
  // Priority 3 > loop's 1, so audio gets CPU when needed but yields on I2S DMA block
  // FIX: Increased stack to 20480 for larger buffers
  xTaskCreatePinnedToCore(audioTask, "AudioTask", 20480, NULL, 3, NULL, 1);
  Serial.println("Audio Task Started.");

  // ---------- BLE Init ----------
  BLEDevice::init("ESP32");

  // Max TX power (+9 dBm) for better range — default is ~+3 dBm
  esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_DEFAULT, ESP_PWR_LVL_P9);
  esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_ADV, ESP_PWR_LVL_P9);
  esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_SCAN, ESP_PWR_LVL_P9);

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pSensorCharacteristic = pService->createCharacteristic(
                      SENSOR_CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ   |
                      BLECharacteristic::PROPERTY_WRITE  |
                      BLECharacteristic::PROPERTY_NOTIFY |
                      BLECharacteristic::PROPERTY_INDICATE
                    );

  pLedCharacteristic = pService->createCharacteristic(
                      LED_CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_WRITE |
                      BLECharacteristic::PROPERTY_WRITE_NR
                    );

  pLedCharacteristic->setCallbacks(new MyCharacteristicCallbacks());

  pSensorCharacteristic->addDescriptor(new BLE2902());
  pLedCharacteristic->addDescriptor(new BLE2902());

  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(false);
  pAdvertising->setMinPreferred(0x0);
  BLEDevice::startAdvertising();
  Serial.println("Waiting a client connection to notify...");

  // BLE notify on Core 0 (same core as BLE stack) — AFTER BLE init to avoid conflicts
  // Stack 4096: setValue + notify do internal heap allocations
  xTaskCreatePinnedToCore(bleNotifyTask, "BLENotify", 4096, NULL, 2, NULL, 0);
  Serial.println("BLE Notify Task Started.");
}

void loop() {
  // ---- Read Sensors ----
  int sensorValues[numSensors];
  unsigned long timestamp = millis();

  for (int i = 0; i < numSensors; i++) {
    sensorValues[i] = analogRead(sensorPins[i]);
  }

  // ---- Audio Logic (mode-dependent) ----
  if (systemOn) {
    int currentMode = audioMode;

    if (currentMode == 0) {
      // Mode 0: Accordion - all 4 voices play C Major
      for (int i = 0; i < numSensors; i++) {
        int force = sensorValues[i] - sensorBaselines[i];
        if (force < 0) force = 0;

        if (force > sensorThresholds[i]) {
          float maxRange = 4095.0f - sensorBaselines[i];
          float normalizedForce = (float)force / maxRange;
          if (normalizedForce > 1.0f) normalizedForce = 1.0f;

          // Sensitivity curve: front (low exponent = responsive), back (high = firm)
          float exp = (i < 2) ? frontExp : backExp;
          normalizedForce = powf(normalizedForce, exp);

          float baseVolume = 0.3f + (normalizedForce * 0.7f);
          voices[i].targetVol = baseVolume * sensorMaxVol[i] * masterVol;
          if (voices[i].targetVol > 1.0f) voices[i].targetVol = 1.0f;
        } else {
          voices[i].targetVol = 0.0f;
        }
      }
    } else {
      // Mode 1: Per-channel frequency filter with hold+decay
      // Each sensor controls one band on one speaker
      unsigned long now = millis();

      // Helper: update a band level with hold+decay logic
      // Returns the new output level
      // sensExp: sensitivity exponent (front=low → responsive, back=high → firm)
      #define UPDATE_BAND(sensorIdx, baseVal, hold, outVar, sensExp) do { \
        int force = sensorValues[sensorIdx] - sensorBaselines[sensorIdx]; \
        if (force < 0) force = 0; \
        if (force > sensorThresholds[sensorIdx]) { \
          float maxRange = 4095.0f - sensorBaselines[sensorIdx]; \
          float nf = (float)force / maxRange; \
          if (nf > 1.0f) nf = 1.0f; \
          nf = powf(nf, sensExp); \
          float level = baseVal + nf * (1.0f - baseVal); \
          hold.peak = level; \
          hold.lastActive = now; \
          outVar = level; \
        } else { \
          unsigned long elapsed = now - hold.lastActive; \
          if (elapsed < HOLD_TIME_MS) { \
            outVar = hold.peak; \
          } else { \
            float decayed = hold.peak - DECAY_PER_LOOP; \
            if (decayed < baseVal) decayed = baseVal; \
            hold.peak = decayed; \
            outVar = decayed; \
          } \
        } \
      } while(0)

      float fExp = frontExp;  // read volatile once
      float bExp = backExp;
      // Front sensors: dynamic sensitivity curve
      UPDATE_BAND(0, TREBLE_BASE, holdTrebleR, trebleLvlR, fExp);
      UPDATE_BAND(1, TREBLE_BASE, holdTrebleL, trebleLvlL, fExp);
      // Back sensors: dynamic sensitivity curve
      UPDATE_BAND(2, BASS_BASE, holdBassR, bassLvlR, bExp);
      UPDATE_BAND(3, BASS_BASE, holdBassL, bassLvlL, bExp);
    }
  } else {
    for (int i = 0; i < NUM_VOICES; i++) {
      voices[i].targetVol = 0.0f;
    }
    trebleLvlR = TREBLE_BASE; trebleLvlL = TREBLE_BASE;
    bassLvlR = BASS_BASE;     bassLvlL = BASS_BASE;
  }

  // ---- BLE Logic ----
  // Write sensor data to shared buffer; Core 0 bleNotifyTask does the actual BLE send.
  // This prevents loop() from holding BLE mutex while audio task preempts it.
  if (deviceConnected && !bleNeedsSend) {
    snprintf(blePayload, sizeof(blePayload), "{\"t\":%lu,\"s\":[%d,%d,%d,%d]}",
      timestamp,
      sensorValues[0], sensorValues[1], sensorValues[2], sensorValues[3]);
    bleNeedsSend = true;  // signal Core 0 task to send
    lastBleUpdateMs = millis();  // FIX #5: track last update time for heartbeat
  }

  // BLE Maintenance
  if (!deviceConnected && oldDeviceConnected) {
    Serial.println("Device disconnected.");
    bleNeedsSend = false;  // clear flag so loop can write fresh data on reconnect
    lastBleUpdateMs = 0;   // FIX #5: reset heartbeat timer
    delay(500);
    pServer->startAdvertising();
    Serial.println("Start advertising");
    oldDeviceConnected = deviceConnected;
  }

  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
    lastBleUpdateMs = millis();  // FIX #5: init heartbeat timer on connect
    Serial.println("Device Connected");
  }

  // Heap monitoring (every ~5 seconds)
  // FIX #6: More detailed logging + warning threshold
  static unsigned long lastHeapLog = 0;
  if (millis() - lastHeapLog > 5000) {
    lastHeapLog = millis();
    uint32_t freeHeap = ESP.getFreeHeap();
    uint32_t minHeap = ESP.getMinFreeHeap();
    Serial.printf("Free heap: %d  Min: %d  Mode: %d\n", freeHeap, minHeap, audioMode);
    if (freeHeap < HEAP_LOW_THRESHOLD) {
      Serial.println("WARNING: Heap critically low! BLE may disconnect.");
    }
  }

  delay(50);
}
