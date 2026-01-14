import React, { createContext, useContext, useState, useEffect } from 'react';
import { EspApi } from '../services/api';

interface ConnectionContextType {
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);

export function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Initial check
    setIsConnected(EspApi.isConnected());
  }, []);

  const connect = async () => {
    await EspApi.connect();
    setIsConnected(true);
  };

  const disconnect = () => {
    EspApi.disconnect();
    setIsConnected(false);
  };

  return (
    <ConnectionContext.Provider value={{ isConnected, connect, disconnect }}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection() {
  const context = useContext(ConnectionContext);
  if (context === undefined) {
    throw new Error('useConnection must be used within a ConnectionProvider');
  }
  return context;
}
