import { useState, useEffect } from 'react'
import '../App.css'
import { bleService } from '../BleService'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

export function Home() {
  const [isConnected, setIsConnected] = useState(false)
  const [sensorValue, setSensorValue] = useState<string>('No data')
  const [ledState, setLedState] = useState(false)

  useEffect(() => {
    const handleSensorUpdate = (value: string) => {
      setSensorValue(value)
    }

    bleService.subscribeToSensor(handleSensorUpdate)

    return () => {
      bleService.unsubscribeFromSensor(handleSensorUpdate)
    }
  }, [])

  const handleConnect = async () => {
    try {
      await bleService.connect()
      setIsConnected(true)
    } catch (error) {
      console.error('Failed to connect:', error)
    }
  }

  const handleDisconnect = () => {
    bleService.disconnect()
    setIsConnected(false)
    setSensorValue('No data')
  }

  const toggleLed = async (checked: boolean) => {
    try {
      // The switch passes the new checked state directly
      await bleService.setLed(checked)
      setLedState(checked)
    } catch (error) {
      console.error('Failed to toggle LED:', error)
      // Revert state if the BLE command fails (optional UI improvement)
      // setLedState(!checked) 
    }
  }

  return (
    <div className="p-4 flex flex-col items-center gap-6">
      <h1 className="text-3xl font-bold">Sensory Feedback App</h1>
      
      {!isConnected ? (
        <Button onClick={handleConnect} size="lg">
          Connect to Device
        </Button>
      ) : (
        <div className="flex flex-col gap-6 w-full max-w-md">
           <div className="flex justify-center">
             <Button onClick={handleDisconnect} variant="destructive">
               Disconnect
             </Button>
           </div>
          
           <div className="grid gap-4">
             <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6 flex flex-col items-center gap-2">
               <h2 className="text-xl font-semibold">Sensor Value</h2>
               <p className="text-4xl font-bold">{sensorValue}</p>
             </div>

             <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6 flex items-center justify-between">
               <span className="text-lg font-medium">LED Control</span>
               <div className="flex items-center gap-2">
                 <span className="text-sm text-muted-foreground">{ledState ? 'ON' : 'OFF'}</span>
                 <Switch 
                   checked={ledState}
                   onCheckedChange={toggleLed}
                 />
               </div>
             </div>
           </div>
        </div>
      )}
    </div>
  )
}
