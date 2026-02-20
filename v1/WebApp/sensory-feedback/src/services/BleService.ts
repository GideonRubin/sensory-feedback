/// <reference types="web-bluetooth" />
import { config } from '../config';

export const SERVICE_UUID = "19b10000-e8f2-537e-4f6c-d104768a1214";
export const SENSOR_CHARACTERISTIC_UUID = "19b10001-e8f2-537e-4f6c-d104768a1214";
export const COMMAND_CHARACTERISTIC_UUID = "19b10002-e8f2-537e-4f6c-d104768a1214";

type SensorCallback = (value: string) => void;

interface IBleService {
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  write(data: Uint8Array): Promise<void>;
  read(): Promise<Uint8Array>;
  subscribeToSensor(callback: SensorCallback): void;
  unsubscribeFromSensor(callback: SensorCallback): void;
}

class BleService implements IBleService {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private sensorCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private commandCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private sensorCallbacks: SensorCallback[] = [];

  constructor() {
    this.handleSensorChanged = this.handleSensorChanged.bind(this);
    this.onDisconnected = this.onDisconnected.bind(this);
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

      this.device.addEventListener('gattserverdisconnected', this.onDisconnected);

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
    if (!this.commandCharacteristic) {
      console.warn('Command Characteristic not found');
      return;
    }
    await this.commandCharacteristic.writeValue(new Uint8Array(data));
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

  private onDisconnected(_event: Event): void {
    console.log('Device disconnected');
    // Notify listeners if needed, or handle auto-reconnect
  }
}

class BleStubService implements IBleService {
  private connected = false;
  private sensorCallbacks: SensorCallback[] = [];
  private intervalId: any = null;

  async connect(): Promise<void> {
    console.log('[STUB] Connecting...');
    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate delay
    this.connected = true;
    console.log('[STUB] Connected!');
    
    // Start simulating sensor data
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
    console.log(`[STUB] Write bytes: ${Array.from(data)}`);
  }

  async read(): Promise<Uint8Array> {
    if (!this.connected) {
      console.warn('[STUB] Not connected');
      return new Uint8Array();
    }
    console.log(`[STUB] Read`);
    return new Uint8Array();
  }

  subscribeToSensor(callback: SensorCallback): void {
    this.sensorCallbacks.push(callback);
  }

  unsubscribeFromSensor(callback: SensorCallback): void {
    this.sensorCallbacks = this.sensorCallbacks.filter(cb => cb !== callback);
  }

  private startSimulatingData() {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      // Simulate complex sensor data (4 sensors)
      const now = Date.now() / 1000;
      const data = [0, 1, 2, 3].map(id => {
          // Send raw adc values (0-4095)
          // Use simple sine waves with different phases
          const rawValue = Math.max(0, Math.sin(now + id) * 2000 + 1000); 
          return {
              id,
              data: [{ amplitude: Math.floor(rawValue) }]
          };
      });

      const jsonString = JSON.stringify(data);
      this.sensorCallbacks.forEach(cb => cb(jsonString));
    }, 100); // 10Hz simulator
  }

  private stopSimulatingData() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

export const bleService = config.useStubs ? new BleStubService() : new BleService();

