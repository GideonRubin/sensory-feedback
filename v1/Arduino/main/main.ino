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
// CHANGE: Removed 'const', made volatile so it can change dynamically
volatile float VOL = 1.0f; 
// Store max volume per sensor (0.0 to 100.0 from app -> normalized 0.0 to 1.0 or similar)
// User wants 100 as max, 0 as min. We'll store as float 0.0-1.0 for calculation.
volatile float sensorMaxVol[4] = {1.0f, 1.0f, 1.0f, 1.0f};
volatile int sensorBaselines[4] = {300, 300, 300, 300}; // ערכי ברירת מחדל עד לכיול הראשון
volatile int sensorThresholds[4] = {20, 20, 20, 20};   // סף הפעלה לכל חיישן (ביח' ADC)
volatile float masterVol = 1.0f;                        // עוצמת שמע כללית (0.0-1.0)
volatile bool systemOn = true; // Default to TRUE (On) as per user request (switched off only via button)

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

// Audio Task Globals
volatile int targetTrack = 0;   
volatile float targetPan = 0.5f;
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

// ---------- Audio Task ----------
void audioTask(void *parameter) {
  File wavFile;
  // Increase buffer size slightly for stability if needed, or keep 512
  const size_t bufSize = 1024; 
  int16_t *buffer = (int16_t *)heap_caps_malloc(bufSize, MALLOC_CAP_DMA);
  
  if (buffer == NULL) {
    Serial.println("Failed to allocate audio buffer");
    vTaskDelete(NULL);
    return;
  }

  int currentTrackID = 0;
  bool firstBuffer = false;
  
  // Enable the channel
  i2s_channel_enable(tx_handle);

  while (true) {
    // Check global systemOn flag (extern or just check targetTrack which is 0 when off)
    // If we want to completely stop playing even silence when off, we could check systemOn.
    // However, I2S usually needs a steady stream to avoid pops when resuming.
    // Writing 0s (silence) is the standard way to "not play". 
    // If we stop writing, the I2S DMA buffer might run dry or emit noise.
    
    // Check if we need to switch tracks
    if (targetTrack != currentTrackID) {
      if (wavFile) wavFile.close();
      currentTrackID = targetTrack;
      
      if (currentTrackID > 0) {
        char path[16];
        // Format: /0001.wav, /0002.wav, etc. matches common SD structure
        snprintf(path, sizeof(path), "/%04d.wav", currentTrackID);
        
        if (SD.exists(path)) {
            wavFile = SD.open(path);
            if (wavFile) {
              // Skip WAV header (typical 44 bytes)
              wavFile.seek(44);
              firstBuffer = true; 
            } else {
              currentTrackID = 0;
            }
        } else {
            // File doesn't exist
            currentTrackID = 0;
        }
      }
    }

    if (currentTrackID > 0 && wavFile && wavFile.available()) {
      float gainL = (1.0f - targetPan) * VOL;
      float gainR = targetPan * VOL;

      size_t bytesRead = wavFile.read((uint8_t*)buffer, bufSize);
      size_t samples = bytesRead / 2; // 16-bit samples

      // Apply volume/panning
      for (int i = 0; i < samples; i+=2) {
         // Simple fade-in for first buffer to avoid clicks could go here
         float smoothFactor = 1.0f;
         if (firstBuffer) {
           smoothFactor = (float)i / samples; 
         }
         
         // Stereo processing: even indices are Left (usually), odd are Right
         // Note: buffer contains interleaved 16-bit samples [L, R, L, R...]
         if (i+1 < samples) {
             buffer[i]   = (int16_t)((float)buffer[i]   * gainL * smoothFactor);
             buffer[i+1] = (int16_t)((float)buffer[i+1] * gainR * smoothFactor);
         }
      }
      
      firstBuffer = false; 
      size_t bytesWritten = 0;
      i2s_channel_write(tx_handle, buffer, bytesRead, &bytesWritten, portMAX_DELAY);
      
      // Loop the track if we reach the end but target hasn't changed
      if (bytesRead < bufSize) {
          wavFile.seek(44); 
      }
    } else {
      // Silence when no track is playing
      memset(buffer, 0, bufSize);
      size_t bytesWritten = 0;
      i2s_channel_write(tx_handle, buffer, bufSize, &bytesWritten, portMAX_DELAY);
      // Small delay to yield to other tasks
      vTaskDelay(10 / portTICK_PERIOD_MS);
    }
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

  // ---------- SD & I2S Setup ----------
  // Initialize SPI for SD Card
  SPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI, SD_CS_PIN);
  if (!SD.begin(SD_CS_PIN)) {
    Serial.println("SD Init Failed!");
    // We continue mostly so BLE can still work, but audio won't
  } else {
    Serial.println("SD Card Ready");
  }

  // Initialize I2S
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
  xTaskCreatePinnedToCore(audioTask, "AudioTask", 4096, NULL, 10, NULL, 0);
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
  if (!systemOn) {
    // If system is OFF, silence audio and do not process audio logic
    if (VOL != 0.0f) VOL = 0.0f;
    if (targetTrack != 0) targetTrack = 0;
    
    // We still need to handle BLE connections, so we fall through to BLE Logic
  }

  // ---- Read Sensors ----
  int sensorValues[numSensors];
  int maxForce = 0; // עכשיו אנחנו מחפשים את ה*כוח* המקסימלי (אחרי קיזוז הכיול) ולא את הערך הגולמי
  int maxIdx = -1;
  unsigned long timestamp = millis();

  for (int i = 0; i < numSensors; i++) {
    sensorValues[i] = analogRead(sensorPins[i]);

    // חישוב הכוח הנקי על ידי חיסור ערך הכיול מהערך הנוכחי
    int force = sensorValues[i] - sensorBaselines[i];
    if (force < 0) force = 0; // התעלם מלחץ נמוך יותר ממצב המנוחה

    if (force > maxForce) {
      maxForce = force;
      maxIdx = i;
    }
  }

  // ---- Audio Logic (New Logic) ----
  static int currentWinner = -1;
  if (systemOn) {
    // בדיקה אם הכוח עובר את הסף של החיישן המוביל
    if (maxIdx >= 0 && maxForce > sensorThresholds[maxIdx]) {

        // חישוב הכוח בטווח מנורמל (מקו הכיול ועד המקסימום האפשרי)
        float normalizedForce = (float)maxForce / (4095.0f - sensorBaselines[maxIdx]);
        if (normalizedForce < 0) normalizedForce = 0;
        if (normalizedForce > 1) normalizedForce = 1;

        float scalingFactor = sensorMaxVol[maxIdx];

        float baseVolume = 0.5f + (normalizedForce * 0.5f);
        VOL = baseVolume * scalingFactor * masterVol;
        // מניעת חריגה שגורמת לעיוות שמע
        if (VOL > 1.0f) VOL = 1.0f;

        if (maxIdx != currentWinner) {
          currentWinner = maxIdx;
          targetTrack = currentWinner + 1; // Tracks 1..4
          targetPan = (currentWinner == 0 || currentWinner == 2) ? 0.0f : 1.0f;
        }
    } else {
        // Signal below threshold -> silence
        VOL = 0.0f;
    }
  } else {
      // System is OFF
      targetTrack = 0;
      currentWinner = -1;
      VOL = 0.0f;
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