/// <reference types="web-bluetooth" />
import { config } from '../config';

export const SERVICE_UUID = "19b10000-e8f2-537e-4f6c-d104768a1214";
export const SENSOR_CHARACTERISTIC_UUID = "19b10001-e8f2-537e-4f6c-d104768a1214";
export const COMMAND_CHARACTERISTIC_UUID = "19b10002-e8f2-537e-4f6c-d104768a1214";

type SensorCallback = (value: string) => void;
type DisconnectCallback = () => void;

interface IBleService {
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  write(data: Uint8Array): Promise<void>;
  read(): Promise<Uint8Array>;
  subscribeToSensor(callback: SensorCallback): void;
  unsubscribeFromSensor(callback: SensorCallback): void;
  onDisconnect(callback: DisconnectCallback): void;
}

class BleService implements IBleService {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private sensorCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private commandCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private sensorCallbacks: SensorCallback[] = [];
  private disconnectCallbacks: DisconnectCallback[] = [];
  private writeQueue: Promise<void> = Promise.resolve(); // Serialize BLE writes

  constructor() {
    this.handleSensorChanged = this.handleSensorChanged.bind(this);
    this.handleDisconnected = this.handleDisconnected.bind(this);
  }

  async connect(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth API is not available in this browser.');
    }

    try {
      console.log('Requesting Bluetooth Device...');
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ name: 'ESP32' }],
        optionalServices: [SERVICE_UUID]
      });

      this.device.addEventListener('gattserverdisconnected', this.handleDisconnected);

      console.log('Connecting to GATT Server...');
      this.server = await this.device.gatt!.connect();

      console.log('Getting Service...');
      const service = await this.server.getPrimaryService(SERVICE_UUID);

      console.log('Getting Characteristics...');
      this.sensorCharacteristic = await service.getCharacteristic(SENSOR_CHARACTERISTIC_UUID);
      this.commandCharacteristic = await service.getCharacteristic(COMMAND_CHARACTERISTIC_UUID);

      console.log('Starting Notifications...');
      await this.sensorCharacteristic.startNotifications();
      this.sensorCharacteristic.addEventListener('characteristicvaluechanged', this.handleSensorChanged);

      console.log('Connected!');
    } catch (error) {
      console.error('Connection failed', error);
      throw error;
    }
  }

  disconnect(): void {
    if (this.device && this.device.gatt?.connected) {
      this.device.gatt.disconnect();
    }
  }

  isConnected(): boolean {
    return !!(this.device && this.device.gatt?.connected);
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.commandCharacteristic || !this.isConnected()) {
      console.warn('Not connected or characteristic not found');
      return;
    }
    // Queue writes to prevent "GATT operation already in progress" errors
    const doWrite = async () => {
      if (!this.commandCharacteristic || !this.isConnected()) return;
      // Timeout to prevent stuck writes from blocking the queue
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('BLE write timeout')), 3000)
      );
      await Promise.race([
        this.commandCharacteristic.writeValueWithoutResponse(new Uint8Array(data)),
        timeout
      ]);
    };
    this.writeQueue = this.writeQueue.then(doWrite).catch(err => {
      console.warn('BLE write failed:', err.message);
    });
    return this.writeQueue;
  }
  
  async read(): Promise<Uint8Array> {
      if (!this.commandCharacteristic) {
        console.warn('Command Characteristic not found');
        return new Uint8Array();
      }
      const value = await this.commandCharacteristic.readValue();
      return new Uint8Array(value.buffer);
  }

  subscribeToSensor(callback: SensorCallback): void {
    this.sensorCallbacks.push(callback);
  }

  unsubscribeFromSensor(callback: SensorCallback): void {
    this.sensorCallbacks = this.sensorCallbacks.filter(cb => cb !== callback);
  }

  private handleSensorChanged(event: Event): void {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    const value = characteristic.value;
    if (value) {
      const decoder = new TextDecoder('utf-8');
      const stringValue = decoder.decode(value);
      // console.log('Received sensor data:', stringValue);
      this.sensorCallbacks.forEach(cb => cb(stringValue));
    }
  }

  onDisconnect(callback: DisconnectCallback): void {
    this.disconnectCallbacks.push(callback);
  }

  private handleDisconnected(_event: Event): void {
    console.log('Device disconnected');
    this.disconnectCallbacks.forEach(cb => cb());
  }
}

class BleStubService implements IBleService {
  private connected = false;
  private sensorCallbacks: SensorCallback[] = [];
  private disconnectCallbacks: DisconnectCallback[] = [];
  private intervalId: any = null;
  private mode: number = 0;          // 0 = accordion, 1 = song
  private sensitivity: number = 75;  // 0-100 slider
  private tick: number = 0;

  async connect(): Promise<void> {
    console.log('[STUB] Connecting...');
    await new Promise(resolve => setTimeout(resolve, 500));
    this.connected = true;
    this.tick = 0;
    console.log('[STUB] Connected!');
    this.startSimulatingData();
  }

  disconnect(): void {
    console.log('[STUB] Disconnecting...');
    this.connected = false;
    this.stopSimulatingData();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.connected) {
      console.warn('[STUB] Not connected');
      return;
    }
    const cmd = new TextDecoder().decode(data);
    console.log(`[STUB] Command: ${cmd}`);

    // Parse commands like the real ESP32
    const sep = cmd.indexOf(':');
    if (sep === -1) return;
    const command = cmd.substring(0, sep);
    const value = cmd.substring(sep + 1);

    if (command === 'MODE') {
      this.mode = parseInt(value);
      console.log(`[STUB] Mode → ${this.mode === 0 ? 'Accordion' : 'Song'}`);
    } else if (command === 'SENSITIVITY') {
      this.sensitivity = parseFloat(value);
      console.log(`[STUB] Sensitivity → ${this.sensitivity}`);
    }
  }

  async read(): Promise<Uint8Array> {
    if (!this.connected) return new Uint8Array();
    return new Uint8Array();
  }

  subscribeToSensor(callback: SensorCallback): void {
    this.sensorCallbacks.push(callback);
  }

  unsubscribeFromSensor(callback: SensorCallback): void {
    this.sensorCallbacks = this.sensorCallbacks.filter(cb => cb !== callback);
  }

  onDisconnect(callback: DisconnectCallback): void {
    this.disconnectCallbacks.push(callback);
  }

  // ---------- Simulation Engine ----------
  // Matches real ESP32: compact JSON at 20Hz (50ms), raw ADC values 0-4095
  // Song mode: intense, fast walking with bursts and overlapping foot strikes
  // Accordion mode: gentler, steady walking pattern

  private startSimulatingData() {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.tick++;
      const t = this.tick * 0.05; // seconds (50ms per tick)
      const ts = Date.now();

      let rf: number, lf: number, rb: number, lb: number; // raw ADC 0-4095

      if (this.mode === 1) {
        // ---- Song Mode: Intense walking simulation ----
        // Fast walking cadence (~2 steps/sec = 120 BPM)
        // Right foot: phase 0, Left foot: phase PI
        // Within each foot: Back (heel) strikes first, Front (toe) pushes off after
        const walkFreq = 2.0 * Math.PI * 1.0; // 1 full gait cycle per second
        const rightPhase = t * walkFreq;
        const leftPhase = t * walkFreq + Math.PI;

        // Heel strike: sharp attack, quick decay (impact)
        const heelStrike = (phase: number) => {
          const p = ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          // Narrow pulse at phase 0 (heel contact)
          if (p < 0.8) return Math.pow(Math.cos(p * Math.PI / 1.6), 2);
          return 0;
        };

        // Toe pushoff: slower build, moderate peak, comes after heel
        const toePush = (phase: number) => {
          const p = ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          // Delayed pulse (starts at phase ~1.2, peaks at ~2.0)
          if (p > 1.0 && p < 3.0) return Math.pow(Math.sin((p - 1.0) * Math.PI / 2.0), 2);
          return 0;
        };

        // Random micro-bursts (simulate uneven ground, stumbles, tempo changes)
        const burst = Math.sin(t * 7.3) > 0.85 ? 0.3 : 0;
        const jitter = () => (Math.random() - 0.5) * 200; // ±200 ADC noise

        // Sensitivity affects how raw values map (higher sensitivity = stronger signal)
        const sensGain = 0.7 + (this.sensitivity / 100) * 0.6; // 0.7 to 1.3

        // Raw ADC values (baseline ~300, max ~3800)
        rf = 300 + (toePush(rightPhase) * 3200 + burst * 1500) * sensGain + jitter();
        lf = 300 + (toePush(leftPhase) * 3200 + burst * 1200) * sensGain + jitter();
        rb = 300 + (heelStrike(rightPhase) * 3500 + burst * 1800) * sensGain + jitter();
        lb = 300 + (heelStrike(leftPhase) * 3500 + burst * 1600) * sensGain + jitter();

        // Occasional "running" bursts: both feet active simultaneously
        if (Math.sin(t * 0.3) > 0.7) {
          const runBoost = 800 * Math.abs(Math.sin(t * 5));
          rf += runBoost;
          rb += runBoost * 1.2;
        }

      } else {
        // ---- Accordion Mode: Steady, deliberate stepping ----
        const walkFreq = 2.0 * Math.PI * 0.6; // slower walk (0.6 Hz)
        const rightPhase = t * walkFreq;
        const leftPhase = t * walkFreq + Math.PI;

        const step = (phase: number) => {
          const p = ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          if (p < 2.5) return Math.pow(Math.sin(p * Math.PI / 2.5), 2);
          return 0;
        };

        const jitter = () => (Math.random() - 0.5) * 100;

        rf = 300 + step(rightPhase - 0.3) * 2800 + jitter();
        lf = 300 + step(leftPhase - 0.3) * 2800 + jitter();
        rb = 300 + step(rightPhase) * 2500 + jitter();
        lb = 300 + step(leftPhase) * 2500 + jitter();
      }

      // Clamp to valid ADC range
      const clamp = (v: number) => Math.max(0, Math.min(4095, Math.floor(v)));

      // Send compact JSON format (matches real ESP32 firmware)
      const json = JSON.stringify({
        t: ts,
        s: [clamp(rf), clamp(lf), clamp(rb), clamp(lb)]
      });
      this.sensorCallbacks.forEach(cb => cb(json));

    }, 50); // 20Hz — matches real ESP32 loop delay
  }

  private stopSimulatingData() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

export const bleService = config.useStubs ? new BleStubService() : new BleService();

