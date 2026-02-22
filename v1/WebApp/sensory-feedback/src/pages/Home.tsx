import { useState, useEffect, useRef } from 'react'
import { EspApi } from '../services/api'
import { useConnection } from '@/context/ConnectionContext'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Power, Volume2, XCircle, CheckCircle2, Music, AudioWaveform, Footprints, Loader2 } from 'lucide-react'
import type { AudioMode } from '../services/api'

interface Notification {
  message: string;
  type: 'success' | 'error';
}

export function Home() {
  const { isConnected, isReconnecting, connect, disconnect } = useConnection()
  const [ledState, setLedState] = useState(true)
  const [volume, setVolume] = useState([100]) // Default volume 100
  const [audioMode, setAudioMode] = useState<AudioMode>(0)
  const [sensitivity, setSensitivity] = useState([75]) // 0=back, 50=balanced, 100=front
  const [notification, setNotification] = useState<Notification | null>(null)
  const prevConnected = useRef(false)
  const prevReconnecting = useRef(false)

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Re-sync state to ESP32 on first connect (user toggled on)
  useEffect(() => {
    if (isConnected && !prevConnected.current) {
      syncStateToDevice();
    }
    prevConnected.current = isConnected;
  }, [isConnected]);

  // Re-sync state to ESP32 after auto-reconnect completes
  // (isConnected stays true during reconnect, so we watch isReconnecting instead)
  useEffect(() => {
    if (!isReconnecting && prevReconnecting.current && isConnected) {
      // Reconnect just finished successfully — re-send mode, volume, etc.
      syncStateToDevice();
      showNotification('Reconnected', 'success');
    }
    prevReconnecting.current = isReconnecting;
  }, [isReconnecting, isConnected]);

  const showNotification = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type });
  }

  const syncStateToDevice = async () => {
    // Small delay to let BLE connection stabilize
    await new Promise(resolve => setTimeout(resolve, 300));
    try {
      await EspApi.setMode(audioMode);
      EspApi.setVolumeTotal(volume[0]);
      for (let i = 0; i < 4; i++) {
        EspApi.setSensorVolume(i, volume[0]);
      }
      await EspApi.switchOn(ledState);
      EspApi.setSensitivity(sensitivity[0]);
    } catch (error) {
      console.error('Failed to sync state:', error);
    }
  }

  const handleConnectionToggle = async (checked: boolean) => {
    if (checked) {
      try {
        await connect()
        showNotification('Connected successfully', 'success')
      } catch (error) {
        console.error('Failed to connect:', error)
        showNotification('Failed to connect', 'error')
      }
    } else {
      disconnect()
      setLedState(true)
      setAudioMode(0)
      showNotification('Disconnected', 'success')
    }
  }

  const handlePowerClick = async () => {
    if (!isConnected) return;
    try {
      const newState = !ledState
      await EspApi.switchOn(newState)
      setLedState(newState)
    } catch (error) {
      console.error('Failed to toggle LED:', error)
      showNotification('Failed to toggle power', 'error')
    }
  }

  const handleVolumeChange = (value: number[]) => {
    const newVol = value[0];
    setVolume(value);
    if (!isConnected) return;
    EspApi.setVolumeTotal(newVol);
    for(let i=0; i<4; i++) {
      EspApi.setSensorVolume(i, newVol);
    }
  }

  const handleModeChange = (mode: AudioMode) => {
    setAudioMode(mode);
    if (!isConnected) return;
    EspApi.setMode(mode);
  }

  const handleSensitivityChange = (value: number[]) => {
    setSensitivity(value);
    if (!isConnected) return;
    EspApi.setSensitivity(value[0]);
  }

  return (
    <div className="flex flex-col items-center justify-between min-h-[calc(100vh-8rem)] relative bg-background font-roboto">
      {/* Notification Area */}
      <div className={`fixed top-8 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ease-out ${notification ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}>
        {notification && (
          <div className={`flex items-center gap-3 px-6 py-3 rounded-full shadow-lg border backdrop-blur-md ${
            notification.type === 'success'
              ? 'bg-white/90 border-emerald-100 text-emerald-700 shadow-emerald-100/50'
              : 'bg-white/90 border-red-100 text-red-700 shadow-red-100/50'
          }`}>
            {notification.type === 'success' ? <CheckCircle2 className="w-4 h-4"/> : <XCircle className="w-4 h-4"/>}
            <span className="font-medium text-sm">{notification.message}</span>
          </div>
        )}
      </div>

      {/* Reconnecting Overlay */}
      {isReconnecting && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-white/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 animate-in fade-in duration-300">
            <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
            <span className="text-sm font-medium text-slate-500">Reconnecting...</span>
          </div>
        </div>
      )}

      {/* Main Content Group: Centered Vertically */}
      <div className="flex-1 w-full max-w-sm flex flex-col items-center justify-center gap-10 py-8">
        {isConnected && (
            <>
              {/* Buttons Row */}
              <div className="flex items-center justify-center gap-8 animate-in fade-in zoom-in-95 duration-700 ease-out">
                {/* Power Button */}
                <button
                  onClick={handlePowerClick}
                  className={`w-28 h-28 rounded-full flex items-center justify-center transition-all duration-300 active:scale-95 border-[6px] ${
                    ledState
                      ? 'bg-slate-800 border-slate-800 text-white shadow-2xl shadow-slate-300'
                      : 'bg-transparent border-slate-100 text-slate-300 hover:border-slate-200 hover:text-slate-400'
                  }`}
                >
                  <Power className="w-12 h-12" strokeWidth={1.5} />
                </button>
              </div>

              {/* Mode Selector */}
              <div className="w-full px-2 animate-in slide-in-from-bottom-4 duration-700 delay-75 fill-mode-both">
                <div className="flex bg-slate-100 rounded-2xl p-1">
                  <button
                    onClick={() => handleModeChange(0)}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                      audioMode === 0
                        ? 'bg-white text-slate-800 shadow-sm'
                        : 'text-slate-400 hover:text-slate-500'
                    }`}
                  >
                    <AudioWaveform className="w-4 h-4" />
                    Accordion
                  </button>
                  <button
                    onClick={() => handleModeChange(1)}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                      audioMode === 1
                        ? 'bg-white text-slate-800 shadow-sm'
                        : 'text-slate-400 hover:text-slate-500'
                    }`}
                  >
                    <Music className="w-4 h-4" />
                    Song
                  </button>
                </div>
              </div>

              {/* Volume Slider Card */}
              <div className="w-full px-6 py-5 bg-white rounded-3xl border border-slate-100 shadow-xl shadow-slate-100/60 flex items-center gap-4 animate-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both">
                <Volume2 className="w-5 h-5 text-slate-400" />
                <Slider
                  className="flex-1"
                  value={volume}
                  max={100}
                  step={1}
                  onValueChange={handleVolumeChange}
                />
                <span className="text-sm font-medium text-slate-400 w-8 text-right tabular-nums">{volume[0]}</span>
              </div>

              {/* Sensitivity Slider Card */}
              <div className="w-full px-6 py-5 bg-white rounded-3xl border border-slate-100 shadow-xl shadow-slate-100/60 flex flex-col gap-3 animate-in slide-in-from-bottom-4 duration-700 delay-150 fill-mode-both">
                <div className="flex items-center gap-4">
                  <Footprints className="w-5 h-5 text-slate-400" />
                  <Slider
                    className="flex-1"
                    value={sensitivity}
                    max={100}
                    step={1}
                    onValueChange={handleSensitivityChange}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-medium text-slate-300 px-1">
                  <span>Back</span>
                  <span>Front</span>
                </div>
              </div>
            </>
        )}
      </div>

      {/* Bottom Section: Connection Toggle - Anchored Bottom */}
      <div className="flex-shrink-0 flex flex-col items-center gap-4 pb-2">
          <Switch
            checked={isConnected}
            onCheckedChange={handleConnectionToggle}
            className="scale-125 data-[state=checked]:bg-slate-900 border-2 border-transparent data-[state=unchecked]:border-slate-300 data-[state=unchecked]:bg-slate-300"
          />
          <span className={`text-[10px] font-bold tracking-widest text-slate-500 uppercase transition-opacity duration-300 ${isConnected ? 'opacity-0' : 'opacity-100'}`}>
              Tap to Connect
          </span>
      </div>

    </div>
  )
}
