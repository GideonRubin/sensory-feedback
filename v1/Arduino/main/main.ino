/*
  TOM Project
  */
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Arduino.h>
#include <SPI.h>
#include <SD.h>
#include "driver/i2s_std.h"

// ---------- Audio & Pin Configuration ----------
volatile float sensorMaxVol[4] = {1.0f, 1.0f, 1.0f, 1.0f};
volatile int sensorBaselines[4] = {300, 300, 300, 300};
volatile int sensorThresholds[4] = {150, 150, 150, 150};
volatile float masterVol = 1.0f;
volatile bool systemOn = true;

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
  volatile float targetVol;
  float currentVol;
  float panL;
  float panR;
};

Voice voices[NUM_VOICES];

// ---------- Audio Mode ----------
volatile int audioMode = 0;  // 0 = accordion, 1 = song + enrichment

// Mode 1: Song playback from SD card
File songFile;
bool songFileOpen = false;
#define WAV_HEADER_SIZE 44

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

// ---------- Wavetable Generation ----------
void generateAccordionWavetable() {
  // Accordion/reed organ: strong odd harmonics for reedy timbre
  const int numHarmonics = 8;
  const float harmonicNum[] = {1, 2, 3, 4, 5, 6, 7, 8};
  const float harmonicAmp[] = {1.0f, 0.5f, 0.7f, 0.3f, 0.4f, 0.15f, 0.2f, 0.1f};

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

// ---------- Audio Task (Dual Mode) ----------
void audioTask(void *parameter) {
  const size_t numFrames = 256;
  const size_t bufSize = numFrames * 2 * sizeof(int16_t); // stereo 16-bit
  int16_t *buffer = (int16_t *)heap_caps_malloc(bufSize, MALLOC_CAP_DMA);
  int16_t *songBuf = (int16_t *)heap_caps_malloc(bufSize, MALLOC_CAP_DMA);

  if (buffer == NULL || songBuf == NULL) {
    Serial.println("Failed to allocate audio buffers");
    vTaskDelete(NULL);
    return;
  }

  i2s_channel_enable(tx_handle);

  const float attackAlpha  = 0.005f;
  const float releaseAlpha = 0.0008f;

  while (true) {
    memset(buffer, 0, bufSize);

    int currentMode = audioMode;

    // ---- Mode 1: Song + Echo/Doubling + Tremolo (song manipulation) ----
    if (currentMode == 1 && songFileOpen) {
      size_t bytesRead = songFile.read((uint8_t*)songBuf, bufSize);
      if (bytesRead < bufSize) {
        songFile.seek(WAV_HEADER_SIZE);
        if (bufSize - bytesRead > 0) {
          songFile.read((uint8_t*)songBuf + bytesRead, bufSize - bytesRead);
        }
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
    }

    // ---- Mode 0: Accordion wavetable synthesis (all 4 voices) ----
    if (currentMode == 0) {
      for (int v = 0; v < NUM_VOICES; v++) {
        float phase = voices[v].phaseAccumulator;
        float phaseInc = voices[v].phaseIncrement;
        float target = voices[v].targetVol;
        float current = voices[v].currentVol;
        float panL = voices[v].panL;
        float panR = voices[v].panR;

        for (int f = 0; f < (int)numFrames; f++) {
          float alpha = (target > current) ? attackAlpha : releaseAlpha;
          current += alpha * (target - current);

          int idx0 = (int)phase;
          int idx1 = (idx0 + 1) & (WAVETABLE_SIZE - 1);
          float frac = phase - (float)idx0;
          idx0 &= (WAVETABLE_SIZE - 1);

          float sample = (float)wavetable[idx0] + frac * (float)(wavetable[idx1] - wavetable[idx0]);
          float out = sample * current;

          int bufIdx = f * 2;
          buffer[bufIdx]     += (int16_t)(out * panL);
          buffer[bufIdx + 1] += (int16_t)(out * panR);

          phase += phaseInc;
          if (phase >= (float)WAVETABLE_SIZE) {
            phase -= (float)WAVETABLE_SIZE;
          }
        }

        voices[v].phaseAccumulator = phase;
        voices[v].currentVol = current;
      }
    }

    // Clamp to prevent overflow (Mode 0 accumulates, Mode 1 already clamped inline)
    for (int i = 0; i < (int)(numFrames * 2); i++) {
      if (buffer[i] > 32767) buffer[i] = 32767;
      if (buffer[i] < -32768) buffer[i] = -32768;
    }

    size_t bytesWritten = 0;
    i2s_channel_write(tx_handle, buffer, bufSize, &bytesWritten, portMAX_DELAY);
  }
}

// ---------- BLE Callbacks ----------
class MyServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
  };

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
  }
};

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

    // Parse string command: "CMD:DATA"
    String cmdStr = value;
    int separatorIndex = cmdStr.indexOf(':');
    
    // If no separator, it might be a raw command or just garbage, ignore or handle differently
    if (separatorIndex == -1) return;

    String command = cmdStr.substring(0, separatorIndex);
    String data = cmdStr.substring(separatorIndex + 1);

    if (command == "POWER") {
      // פורמט: "POWER:1" (הפעלה) או "POWER:0" (כיבוי)
      int state = data.toInt();
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
    else if (command == "SENSOR_VOLUME") {
      // Data format: "ID,VOLUME"
      int commaIndex = data.indexOf(',');
      if (commaIndex != -1) {
        String idStr = data.substring(0, commaIndex);
        String volStr = data.substring(commaIndex + 1);

        int id = idStr.toInt();
        float volume = volStr.toFloat();

        if (id >= 0 && id < 4) {
          if (volume < 0) volume = 0;
          if (volume > 100) volume = 100;

          sensorMaxVol[id] = volume / 100.0f;
          Serial.printf("Set Sensor %d Max Vol: %f\n", id, sensorMaxVol[id]);
        }
      }
    }
    else if (command == "CALIBRATE") {
      // חילוץ 4 המספרים מהמחרוזת, לדוגמה "CALIBRATE:280,310,295,305"
      int commas[3];
      commas[0] = data.indexOf(',');
      commas[1] = data.indexOf(',', commas[0] + 1);
      commas[2] = data.indexOf(',', commas[1] + 1);

      if (commas[0] != -1 && commas[1] != -1 && commas[2] != -1) {
        sensorBaselines[0] = data.substring(0, commas[0]).toInt();
        sensorBaselines[1] = data.substring(commas[0] + 1, commas[1]).toInt();
        sensorBaselines[2] = data.substring(commas[1] + 1, commas[2]).toInt();
        sensorBaselines[3] = data.substring(commas[2] + 1).toInt();
        Serial.printf("Calibrated Baselines: %d, %d, %d, %d\n", sensorBaselines[0], sensorBaselines[1], sensorBaselines[2], sensorBaselines[3]);
      }
    }
    else if (command == "SENSOR_THRESHOLD") {
      // פורמט: "SENSOR_THRESHOLD:T0,T1,T2,T3" - סף לכל חיישן ביח' ADC
      int commas[3];
      commas[0] = data.indexOf(',');
      commas[1] = data.indexOf(',', commas[0] + 1);
      commas[2] = data.indexOf(',', commas[1] + 1);

      if (commas[0] != -1 && commas[1] != -1 && commas[2] != -1) {
        sensorThresholds[0] = data.substring(0, commas[0]).toInt();
        sensorThresholds[1] = data.substring(commas[0] + 1, commas[1]).toInt();
        sensorThresholds[2] = data.substring(commas[1] + 1, commas[2]).toInt();
        sensorThresholds[3] = data.substring(commas[2] + 1).toInt();
        Serial.printf("Thresholds: %d, %d, %d, %d\n", sensorThresholds[0], sensorThresholds[1], sensorThresholds[2], sensorThresholds[3]);
      }
    }
    else if (command == "VOLUME_TOTAL") {
      // פורמט: "VOLUME_TOTAL:75" - ערך 0-100
      float vol = data.toFloat();
      if (vol < 0) vol = 0;
      if (vol > 100) vol = 100;
      masterVol = vol / 100.0f;
      Serial.printf("Master Volume: %f\n", masterVol);
    }
    else if (command == "MODE") {
      int mode = data.toInt();
      if (mode == 0) {
        audioMode = 0;
        if (songFileOpen) { songFile.close(); songFileOpen = false; }
        // Restore accordion frequencies
        for (int i = 0; i < NUM_VOICES; i++) {
          voices[i].phaseIncrement = (noteFreqs[i] * WAVETABLE_SIZE) / (float)SAMPLE_RATE;
          voices[i].targetVol = 0.0f;
        }
        Serial.println("Mode: Accordion");
      } else if (mode == 1) {
        // Song mode: silence all accordion voices
        for (int i = 0; i < NUM_VOICES; i++) {
          voices[i].targetVol = 0.0f;
        }
        // Reset song manipulation effects
        resetFilterState();
        openSongFile();
        audioMode = 1;
        Serial.println("Mode: Song + Frequency Filter (walk to restore)");
      }
    }
  }
};

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

  // ---------- Synthesis Setup ----------
  generateAccordionWavetable();
  resetFilterState();
  for (int i = 0; i < NUM_VOICES; i++) {
    voices[i].phaseAccumulator = 0.0f;
    voices[i].phaseIncrement = (noteFreqs[i] * WAVETABLE_SIZE) / (float)SAMPLE_RATE;
    voices[i].targetVol = 0.0f;
    voices[i].currentVol = 0.0f;
    // Right foot sensors (0,2) -> left speaker, Left foot sensors (1,3) -> right speaker
    voices[i].panL = (i == 0 || i == 2) ? 1.0f : 0.0f;
    voices[i].panR = (i == 0 || i == 2) ? 0.0f : 1.0f;
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
  
  // Start Audio Task on Core 0 (leaving Core 1 for Arduino Loop/BLE)
  xTaskCreatePinnedToCore(audioTask, "AudioTask", 12288, NULL, 10, NULL, 0);
  Serial.println("Audio Task Started.");

  // ---------- BLE Init ----------
  BLEDevice::init("ESP32");
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
      #define UPDATE_BAND(sensorIdx, baseVal, hold, outVar) do { \
        int force = sensorValues[sensorIdx] - sensorBaselines[sensorIdx]; \
        if (force < 0) force = 0; \
        if (force > sensorThresholds[sensorIdx]) { \
          float maxRange = 4095.0f - sensorBaselines[sensorIdx]; \
          float nf = (float)force / maxRange; \
          if (nf > 1.0f) nf = 1.0f; \
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

      // Sensor 0 (Right Front) → treble on RIGHT speaker
      UPDATE_BAND(0, TREBLE_BASE, holdTrebleR, trebleLvlR);
      // Sensor 1 (Left Front) → treble on LEFT speaker
      UPDATE_BAND(1, TREBLE_BASE, holdTrebleL, trebleLvlL);
      // Sensor 2 (Right Back) → bass on RIGHT speaker
      UPDATE_BAND(2, BASS_BASE, holdBassR, bassLvlR);
      // Sensor 3 (Left Back) → bass on LEFT speaker
      UPDATE_BAND(3, BASS_BASE, holdBassL, bassLvlL);
    }
  } else {
    for (int i = 0; i < NUM_VOICES; i++) {
      voices[i].targetVol = 0.0f;
    }
    trebleLvlR = TREBLE_BASE; trebleLvlL = TREBLE_BASE;
    bassLvlR = BASS_BASE;     bassLvlL = BASS_BASE;
  }

  // ---- BLE Logic ----
  if (deviceConnected) {
    // Construct JSON string
    String json = "[";
    for (int i = 0; i < numSensors; i++) {
      if (i > 0) json += ",";
      json += "{\"id\":";
      json += i;
      json += ",\"data\":[{\"time\":\"";
      json += timestamp;
      json += "\",\"amplitude\":";
      json += sensorValues[i];
      json += "}]}";
    }
    json += "]";

    pSensorCharacteristic->setValue(json.c_str());
    pSensorCharacteristic->notify();
  }

  // BLE Maintenance
  if (!deviceConnected && oldDeviceConnected) {
    Serial.println("Device disconnected.");
    delay(500); 
    pServer->startAdvertising(); 
    Serial.println("Start advertising");
    oldDeviceConnected = deviceConnected;
  }
  
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
    Serial.println("Device Connected");
  }

  delay(25); // Loop delay
}