#include <Arduino.h>
#include "DFRobotDFPlayerMini.h"
// test

// ---------- FSR ----------
const int fsrPins[4] = {34, 35, 32, 33};
int fsrValues[4];

// ---------- DFPlayer ----------
HardwareSerial mp3Serial(2);
DFRobotDFPlayerMini player;

// ---------- State ----------
int currentTrack = 0;     // 0 = stopped, 1..4 playing
int winnerIndex  = -1;

static const int PRESS_THRESHOLD = 200;
static const int SWITCH_MARGIN   = 80;
static const uint32_t RELEASE_MS = 150;

static const int FIXED_VOLUME = 30;

uint32_t lastAboveThresholdMs = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("FSR + DFPlayer (stable continuous mode)");

  for (int i = 0; i < 4; i++) pinMode(fsrPins[i], INPUT);

  mp3Serial.begin(9600, SERIAL_8N1, 16, 17);
  delay(300);

  if (!player.begin(mp3Serial)) {
    Serial.println("DFPlayer init failed!");
    while (true) delay(1000);
  }

  player.outputDevice(DFPLAYER_DEVICE_SD);
  player.EQ(DFPLAYER_EQ_NORMAL);
  player.volume(FIXED_VOLUME);
  delay(100);

  Serial.println("Ready. Files: 0001.mp3 .. 0004.mp3");
}

void loop() {
  // ---- read sensors ----
  int maxValue = 0;
  int maxIndex = -1;

  for (int i = 0; i < 4; i++) {
    fsrValues[i] = analogRead(fsrPins[i]);
    if (fsrValues[i] > maxValue) {
      maxValue = fsrValues[i];
      maxIndex = i;
    }
  }

  // ---- serial debug (like you wanted) ----
  Serial.print("FSR: ");
  for (int i = 0; i < 4; i++) {
    Serial.print(fsrValues[i]);
    if (i < 3) Serial.print("  ");
  }
  Serial.print(" | max=");
  Serial.print(maxValue);
  Serial.print(" idx=");
  Serial.print(maxIndex);
  Serial.print(" | currentTrack=");
  Serial.println(currentTrack);

  uint32_t now = millis();

  // ---- press tracking with release delay ----
  if (maxValue >= PRESS_THRESHOLD) {
    lastAboveThresholdMs = now;
  }

  bool pressed = (now - lastAboveThresholdMs) <= RELEASE_MS;

  // ---- released ----
  if (!pressed) {
    if (currentTrack != 0) {
      player.stop();
      currentTrack = 0;
      winnerIndex = -1;
      Serial.println("STOP");
    }
    delay(25);
    return;
  }

  // ---- determine winner quickly but safely ----
  if (winnerIndex == -1) {
    winnerIndex = maxIndex;
  } else {
    int prevVal = fsrValues[winnerIndex];
    if (maxIndex != winnerIndex &&
        maxValue >= prevVal + SWITCH_MARGIN) {
      winnerIndex = maxIndex;
    }
  }

  int desiredTrack = winnerIndex + 1; // 1..4

  // ---- play ONLY on change ----
  if (desiredTrack != currentTrack) {
    currentTrack = desiredTrack;
    player.play(currentTrack);
    Serial.print("Play track ");
    Serial.println(currentTrack);
  }

  delay(25);
}