/// <reference types="web-bluetooth" />

export const SERVICE_UUID = "19b10000-e8f2-537e-4f6c-d104768a1214";
export const SENSOR_CHARACTERISTIC_UUID = "19b10001-e8f2-537e-4f6c-d104768a1214";
export const LED_CHARACTERISTIC_UUID = "19b10002-e8f2-537e-4f6c-d104768a1214";

type SensorCallback = (value: string) => void;

class BleService {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private sensorCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private ledCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
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
      this.ledCharacteristic = await service.getCharacteristic(LED_CHARACTERISTIC_UUID);

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

  async setLed(on: boolean): Promise<void> {
    if (!this.ledCharacteristic) {
      console.warn('LED Characteristic not found');
      return;
    }
    // Arduino expects '1' or '0' as the first byte
    // int receivedValue = static_cast<int>(value[0]);
    const value = new Uint8Array([on ? 1 : 0]);
    await this.ledCharacteristic.writeValue(value);
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
      this.sensorCallbacks.forEach(cb => cb(stringValue));
    }
  }

  private onDisconnected(_event: Event): void {
    console.log('Device disconnected');
    // Notify listeners if needed, or handle auto-reconnect
  }
}

export const bleService = new BleService();
