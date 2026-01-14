import { useState, useEffect } from 'react'
import { EspApi } from '../services/api'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Power, Volume2, Speaker, XCircle, CheckCircle2 } from 'lucide-react'

interface Notification {
  message: string;
  type: 'success' | 'error';
}

export function Home() {
  const [isConnected, setIsConnected] = useState(false)
  const [ledState, setLedState] = useState(false)
  const [volume, setVolume] = useState([50]) // Default volume 50
  const [notification, setNotification] = useState<Notification | null>(null)

  useEffect(() => {
    // Check initial connection status if possible, or assume disconnected
    setIsConnected(EspApi.isConnected());
  }, [])

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
        await EspApi.connect()
        setIsConnected(true)
        showNotification('Connected successfully', 'success')
      } catch (error) {
        console.error('Failed to connect:', error)
        showNotification('Failed to connect', 'error')
      }
    } else {
      EspApi.disconnect()
      setIsConnected(false)
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

  return (
    <div className="flex flex-col items-center justify-between min-h-[80vh] py-10 px-6 relative">
      
      {/* Notification Area */}
      <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${notification ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}>
        {notification && (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg ${
            notification.type === 'success' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
          }`}>
            {notification.type === 'success' ? <CheckCircle2 className="w-5 h-5"/> : <XCircle className="w-5 h-5"/>}
            <span className="font-medium text-sm">{notification.message}</span>
          </div>
        )}
      </div>

      {/* Top Section: Empty or Status/Title */}
      <div className="flex-1 w-full flex items-center justify-center">
        { /* Placeholder for future content or logo */ }
      </div>

      {isConnected && (
        <div className="flex flex-col items-center w-full max-w-xs gap-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
          
          {/* Action Buttons Row */}
          <div className="flex items-center justify-center gap-12">
            {/* Power Button */}
            <button 
              onClick={handlePowerClick}
              className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg active:scale-90 ${
                ledState 
                  ? 'bg-slate-800 text-white shadow-slate-400/50' 
                  : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
              }`}
            >
              <Power className="w-10 h-10" />
            </button>

            {/* Ping/Record Button (Camera Icon in design, mapped to Ping as requested) */}
            <button 
              onClick={handlePingClick}
              className="w-20 h-20 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center shadow-lg hover:bg-slate-300 transition-all duration-200 active:scale-90"
            >
              <Speaker className="w-8 h-8" />
            </button>
          </div>

          {/* Volume Control */}
          <div className="w-full flex items-center gap-4">
             <Volume2 className="w-6 h-6 text-slate-600" />
             <Slider 
               className="flex-1"
               value={volume} 
               max={100} 
               step={1} 
               onValueChange={handleVolumeChange} 
             />
             <Volume2 className="w-6 h-6 text-slate-900" />
          </div>

        </div>
      )}

      {/* Bottom Section: Connection Toggle */}
      <div className="flex-1 flex flex-col justify-end items-center gap-4 w-full pb-10">
        
        <div className="flex flex-col items-center gap-2">
            <Switch 
              checked={isConnected}
              onCheckedChange={handleConnectionToggle}
              className="scale-125 data-[state=checked]:bg-slate-900"
            />
             <span className={`text-sm text-muted-foreground transition-opacity duration-300 ${isConnected ? 'opacity-0' : 'opacity-100 animate-pulse'}`}>
                Tap to connect
            </span>
        </div>
      </div>

    </div>
  )
}
