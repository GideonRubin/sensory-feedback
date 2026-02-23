import { useState, useEffect, useRef } from 'react'
import { EspApi } from '../services/api'
import type { AudioMode, DiagnosticEvent } from '../services/api'
import { useConnection } from '@/context/ConnectionContext'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Power, Volume2, XCircle, CheckCircle2, Music, AudioWaveform, Footprints, Loader2, ClipboardList, X, AlertTriangle, Wifi, WifiOff, Activity, HardDrive, Heart, Timer, RotateCcw, Cpu, Zap } from 'lucide-react'

interface Notification {
  message: string;
  type: 'success' | 'error';
}

// Persist UI state across page navigations
const STORAGE_KEY = 'tom-ui-state';
function loadState<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const obj = JSON.parse(raw);
    return obj[key] !== undefined ? obj[key] : fallback;
  } catch { return fallback; }
}
function saveState(key: string, value: unknown) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    obj[key] = value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch { /* ignore */ }
}

export function Home() {
  const { isConnected, isReconnecting, connect, disconnect } = useConnection()
  const [ledState, setLedState] = useState(() => loadState('ledState', true))
  const [volume, setVolume] = useState(() => [loadState('volume', 100)])
  const [audioMode, setAudioMode] = useState<AudioMode>(() => loadState('audioMode', 0) as AudioMode)
  const [sensitivity, setSensitivity] = useState(() => [loadState('sensitivity', 75)])
  const [notification, setNotification] = useState<Notification | null>(null)
  const [showDiagLog, setShowDiagLog] = useState(false)
  const [diagEvents, setDiagEvents] = useState<DiagnosticEvent[]>([])
  const [diagLoading, setDiagLoading] = useState(false)
  // Initialize refs with CURRENT value so re-mount while connected doesn't trigger sync
  const prevConnected = useRef(isConnected)
  const prevReconnecting = useRef(isReconnecting)

  // Refs that always hold the latest state — immune to stale closures
  const audioModeRef = useRef<AudioMode>(audioMode)
  const volumeRef = useRef(volume)
  const sensitivityRef = useRef(sensitivity)
  const ledStateRef = useRef(ledState)
  useEffect(() => { audioModeRef.current = audioMode; saveState('audioMode', audioMode) }, [audioMode])
  useEffect(() => { volumeRef.current = volume; saveState('volume', volume[0]) }, [volume])
  useEffect(() => { sensitivityRef.current = sensitivity; saveState('sensitivity', sensitivity[0]) }, [sensitivity])
  useEffect(() => { ledStateRef.current = ledState; saveState('ledState', ledState) }, [ledState])

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Re-sync state to ESP32 on fresh connect (user toggled switch on)
  // prevConnected starts as current isConnected, so re-mount while connected won't trigger
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
      // Auto-fetch diagnostic log after reconnect to see what happened
      handleRequestDiagLog(true);
    }
    prevReconnecting.current = isReconnecting;
  }, [isReconnecting, isConnected]);

  const showNotification = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type });
  }

  const syncStateToDevice = async () => {
    // Small delay to let BLE connection stabilize
    await new Promise(resolve => setTimeout(resolve, 300));
    // Read from refs (not state) to avoid stale closure values
    const mode = audioModeRef.current;
    const vol = volumeRef.current[0];
    const sens = sensitivityRef.current[0];
    const power = ledStateRef.current;
    console.log(`[SYNC] mode=${mode} vol=${vol} sens=${sens} power=${power}`);
    try {
      await EspApi.setMode(mode);
      EspApi.setVolumeTotal(vol);
      for (let i = 0; i < 4; i++) {
        EspApi.setSensorVolume(i, vol);
      }
      await EspApi.switchOn(power);
      EspApi.setSensitivity(sens);
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

  // Request diagnostic log from ESP32
  const handleRequestDiagLog = async (silent = false) => {
    if (!isConnected) return;
    setDiagLoading(true);
    try {
      const events = await EspApi.requestDiagLog();
      setDiagEvents(events);
      if (!silent) {
        setShowDiagLog(true);
      } else if (events.some(e => e.event === 'BLE_DISC' || e.event === 'HEAP_LOW' || e.event === 'LOOP_SLOW')) {
        // Auto-show only if there are interesting events after reconnect
        setShowDiagLog(true);
      }
    } catch (error) {
      console.error('Failed to get diagnostic log:', error);
    } finally {
      setDiagLoading(false);
    }
  }

  // Format millis timestamp to readable relative time
  const formatTimestamp = (ms: number): string => {
    const sec = Math.floor(ms / 1000);
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    if (min > 0) return `${min}m ${s}s`;
    return `${s}s`;
  }

  // Get icon and color for each event type
  const getEventStyle = (event: string): { icon: React.ReactNode; color: string; bg: string } => {
    switch (event) {
      case 'BLE_DISC':
        return { icon: <WifiOff className="w-3.5 h-3.5" />, color: 'text-red-600', bg: 'bg-red-50' };
      case 'BLE_CONN':
        return { icon: <Wifi className="w-3.5 h-3.5" />, color: 'text-emerald-600', bg: 'bg-emerald-50' };
      case 'HEAP_LOW':
        return { icon: <AlertTriangle className="w-3.5 h-3.5" />, color: 'text-amber-600', bg: 'bg-amber-50' };
      case 'HEARTBEAT':
        return { icon: <Heart className="w-3.5 h-3.5" />, color: 'text-rose-500', bg: 'bg-rose-50' };
      case 'LOOP_SLOW':
        return { icon: <Timer className="w-3.5 h-3.5" />, color: 'text-orange-600', bg: 'bg-orange-50' };
      case 'SD_SLOW':
        return { icon: <HardDrive className="w-3.5 h-3.5" />, color: 'text-orange-500', bg: 'bg-orange-50' };
      case 'SD_REWIND':
        return { icon: <RotateCcw className="w-3.5 h-3.5" />, color: 'text-slate-400', bg: 'bg-slate-50' };
      case 'SD_FAIL':
        return { icon: <HardDrive className="w-3.5 h-3.5" />, color: 'text-red-500', bg: 'bg-red-50' };
      case 'MODE_CHG':
        return { icon: <Music className="w-3.5 h-3.5" />, color: 'text-blue-500', bg: 'bg-blue-50' };
      case 'BOOT':
        return { icon: <Zap className="w-3.5 h-3.5" />, color: 'text-purple-500', bg: 'bg-purple-50' };
      case 'HEAP_SNAP':
        return { icon: <Cpu className="w-3.5 h-3.5" />, color: 'text-slate-400', bg: 'bg-slate-50' };
      default:
        return { icon: <Activity className="w-3.5 h-3.5" />, color: 'text-slate-500', bg: 'bg-slate-50' };
    }
  }

  // Get human-readable description for event
  const getEventDescription = (event: string, value: number): string => {
    switch (event) {
      case 'BLE_DISC': return 'BLE Disconnected';
      case 'BLE_CONN': return 'BLE Connected';
      case 'HEAP_LOW': return `Heap Low: ${value}KB free`;
      case 'HEARTBEAT': return 'Heartbeat (loop stalled)';
      case 'LOOP_SLOW': return `Loop stalled: ${value}ms gap`;
      case 'SD_SLOW': return `SD read slow: ${value}ms`;
      case 'SD_REWIND': return 'Song restarted';
      case 'SD_FAIL': return 'SD read failed (0 bytes)';
      case 'MODE_CHG': return value === 1 ? 'Mode → Song' : 'Mode → Accordion';
      case 'BOOT': return `Boot (mode: ${value === 1 ? 'Song' : 'Accordion'})`;
      case 'HEAP_SNAP': return `Heap: ${value}KB free`;
      default: return `${event} (${value})`;
    }
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

              {/* Diagnostic Log Button */}
              <button
                onClick={() => handleRequestDiagLog(false)}
                disabled={diagLoading}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all duration-200 animate-in fade-in duration-700 delay-200 fill-mode-both"
              >
                {diagLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardList className="w-3.5 h-3.5" />}
                Diagnostic Log
              </button>
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

      {/* Diagnostic Log Modal */}
      {showDiagLog && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowDiagLog(false)}>
          <div
            className="w-full max-w-md bg-white rounded-t-3xl shadow-2xl max-h-[75vh] flex flex-col animate-in slide-in-from-bottom duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-semibold text-slate-700">Diagnostic Log</span>
                <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{diagEvents.length} events</span>
              </div>
              <button onClick={() => setShowDiagLog(false)} className="p-1 rounded-full hover:bg-slate-100 transition-colors">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            {/* Event List */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
              {diagEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-300">
                  <Activity className="w-8 h-8 mb-2" />
                  <span className="text-sm font-medium">No events recorded</span>
                </div>
              ) : (
                diagEvents.map((evt, i) => {
                  const style = getEventStyle(evt.event);
                  return (
                    <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-xl ${style.bg}`}>
                      <div className={`flex-shrink-0 ${style.color}`}>{style.icon}</div>
                      <div className="flex-1 min-w-0">
                        <span className={`text-xs font-medium ${style.color}`}>{getEventDescription(evt.event, evt.value)}</span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 flex-shrink-0">{formatTimestamp(evt.timestamp)}</span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Refresh Button */}
            <div className="px-6 py-3 border-t border-slate-100">
              <button
                onClick={() => handleRequestDiagLog(false)}
                disabled={diagLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium transition-colors"
              >
                {diagLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                Refresh
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
