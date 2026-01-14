import { useState, useEffect } from 'react'
import { EspApi } from '../services/api'
import { useConnection } from '@/context/ConnectionContext'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Power, Volume2, Speaker, XCircle, CheckCircle2, BatteryWarning, BatteryMedium, BatteryLow, BatteryFull } from 'lucide-react'

interface Notification {
  message: string;
  type: 'success' | 'error';
}

export function Home() {
  const { isConnected, connect, disconnect } = useConnection()
  const [ledState, setLedState] = useState(false)
  const [volume, setVolume] = useState([50]) // Default volume 50
  const [notification, setNotification] = useState<Notification | null>(null)
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null)

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    
    if (isConnected) {
      // Initial fetch
      EspApi.getBatteryHealth().then(setBatteryLevel);
      
      // Poll every 10 seconds
      interval = setInterval(async () => {
        try {
          const level = await EspApi.getBatteryHealth();
          setBatteryLevel(level);
        } catch (error) {
          console.error("Failed to fetch battery:", error);
        }
      }, 10000);
    } else {
      setBatteryLevel(null);
    }

    return () => {
      if (interval) clearInterval(interval);
    }
  }, [isConnected]);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const showNotification = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type });
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
      setLedState(false)
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

  const handlePingClick = () => {
    if (!isConnected) return;
    EspApi.ping();
  }

  const handleVolumeChange = (value: number[]) => {
    const newVol = value[0];
    setVolume(value);
    if (!isConnected) return;
    EspApi.setVolumeTotal(newVol);
  }

  const getBatteryIcon = (level: number) => {
    if (level > 90) return <BatteryFull className="w-5 h-5" />;
    if (level > 50) return <BatteryMedium className="w-5 h-5" />;
    if (level > 20) return <BatteryLow className="w-5 h-5" />;
    return <BatteryWarning className="w-5 h-5 text-red-500" />;
  }

  return (
    <div className="flex flex-col items-center justify-between min-h-[calc(100vh-8rem)] relative bg-background font-roboto">
      
      {/* Battery Indicator - Fixed Top Right */}
      {isConnected && batteryLevel !== null && (
        <div className="fixed top-6 right-6 z-50 flex items-center gap-1.5 text-slate-400 animate-in fade-in duration-700">
           <span className="text-sm font-medium tracking-wide tabular-nums">{Math.round(batteryLevel)}%</span>
           {getBatteryIcon(batteryLevel)}
        </div>
      )}

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

                {/* Ping Button */}
                <button 
                  onClick={handlePingClick}
                  className="w-28 h-28 rounded-full bg-transparent border-[6px] border-slate-100 text-slate-300 flex items-center justify-center hover:border-slate-200 hover:text-slate-400 transition-all duration-300 active:scale-95"
                >
                  <Speaker className="w-10 h-10" strokeWidth={1.5} />
                </button>
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
            </>
        )}
      </div>

      {/* Bottom Section: Connection Toggle - Anchored Bottom */}
      <div className="flex-shrink-0 flex flex-col items-center gap-4 pb-2">
          <Switch 
            checked={isConnected}
            onCheckedChange={handleConnectionToggle}
            className="scale-125 data-[state=checked]:bg-slate-900 border-2 border-transparent data-[state=unchecked]:border-slate-200 data-[state=unchecked]:bg-slate-100"
          />
          <span className={`text-[10px] font-bold tracking-widest text-slate-300 uppercase transition-opacity duration-300 ${isConnected ? 'opacity-0' : 'opacity-100'}`}>
              Tap to Connect
          </span>
      </div>

    </div>
  )
}
