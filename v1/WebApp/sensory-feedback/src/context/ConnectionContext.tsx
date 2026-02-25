import React, { createContext, useContext, useState, useEffect } from 'react';
import { EspApi } from '../services/api';

interface ConnectionContextType {
  isConnected: boolean;
  isReconnecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);

export function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    // Initial check
    setIsConnected(EspApi.isConnected());

    // Listen for manual/final disconnections (after auto-reconnect gives up)
    EspApi.onDisconnect(() => {
      setIsConnected(false);
      setIsReconnecting(false);
    });

    // Listen for auto-reconnect lifecycle
    EspApi.onReconnect((state) => {
      if (state === 'reconnecting') {
        setIsReconnecting(true);
        // Don't set isConnected=false — UI shows "reconnecting" overlay instead
      } else if (state === 'reconnected') {
        setIsReconnecting(false);
        setIsConnected(true);
      } else if (state === 'failed') {
        setIsReconnecting(false);
        // disconnectCallbacks will fire separately → setIsConnected(false)
      }
    });
  }, []);

  const connect = async () => {
    await EspApi.connect();
    setIsConnected(true);
  };

  const disconnect = () => {
    EspApi.disconnect();
    setIsConnected(false);
    setIsReconnecting(false);
  };

  return (
    <ConnectionContext.Provider value={{ isConnected, isReconnecting, connect, disconnect }}>
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
