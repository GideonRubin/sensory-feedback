import { bleService } from './BleService';

// Types defined in the API Spec
export interface SensorData {
  time: Date;
  amplitude: number;
}

export interface Sensor {
  id: number;
  data: SensorData[];
}

export type Sensors = Sensor[];

export const BleEndpoints = {
  LED: 'LED',
  PING: 'PING',
  VOLUME_TOTAL: 'VOLUME_TOTAL',
  SENSOR_THRESHOLD: 'SENSOR_THRESHOLD',
} as const;

/**
 * Communication between ESP32 and WebApp
 */
export const EspApi = {
  connect: async (): Promise<void> => {
    return bleService.connect();
  },
  disconnect: (): void => {
    bleService.disconnect();
  },
  isConnected: (): boolean => {
    return bleService.isConnected();
  },

  subscribeToSensor: (callback: (value: string) => void): void => {
    bleService.subscribeToSensor(callback);
  },
  
  unsubscribeFromSensor: (callback: (value: string) => void): void => {
    bleService.unsubscribeFromSensor(callback);
  },

  write: async (endpoint: string, data: string): Promise<void> => {
    const command = `${endpoint}:${data}`;
    const encoder = new TextEncoder();
    return bleService.write(encoder.encode(command));
  },
  read: async (endpoint: string): Promise<string> => {
     // Note: This matches the previous behavior where endpoint was ignored for reading 
     // because there is only one characteristic being read.
     const value = await bleService.read();
     const decoder = new TextDecoder('utf-8');
     return decoder.decode(value);
  },

  // First Page
  switchOn: async (isOn: boolean): Promise<void> => {
    // Send raw byte 1 or 0 for LED command to match firmware expectation
    const payload = new Uint8Array([isOn ? 1 : 0]);
    return bleService.write(payload);
  },
  ping: (): void => {
    // TODO: Implement communication with ESP32
    console.log('ping');
  },
  setVolumeTotal: (volume: number): void => {
    // TODO: Implement communication with ESP32
    console.log('setVolumeTotal', volume);
  },
  getVolume: (): number => {
    // TODO: Implement communication with ESP32
    console.log('getVolume');
    return 0.0;
  },

  // Second Page
  getSensorsData: (): Sensor[] => {
    // TODO: Implement communication with ESP32
    console.log('getSensorsData (ESP)');
    return [];
  },
  getSensorsThreshold: (): number[] => {
    // TODO: Implement communication with ESP32
    console.log('getSensorsThreshold');
    return [];
  },
  setSensorsThreshold: (thresholds: number[]): void => {
    // TODO: Implement communication with ESP32
    console.log('setSensorsThreshold', thresholds);
  },
  getSensorVolume: (): number => {
    // TODO: Implement communication with ESP32
    console.log('getSensorVolume');
    return 0.0;
  },
  setSensorVolume: (volume: number): void => {
    // TODO: Implement communication with ESP32
    console.log('setSensorVolume', volume);
  },
};

/**
 * Communication with Vercel Blob
 */
export const blobService = {
  saveSensorData: (sensors: Sensors): void => {
    // TODO: Implement communication with Vercel Blob
    console.log('saveSensorData', sensors);
  },
  getSensorsData: (): Sensors => {
    // TODO: Implement communication with Vercel Blob
    console.log('getSensorsData (Blob)');
    return [];
  },
};
