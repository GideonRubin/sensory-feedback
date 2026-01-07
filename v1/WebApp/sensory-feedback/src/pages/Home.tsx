import { useState, useEffect } from 'react'
import '../App.css'
import { bleService } from '../BleService'

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

  const toggleLed = async () => {
    try {
      const newState = !ledState
      await bleService.setLed(newState)
      setLedState(newState)
    } catch (error) {
      console.error('Failed to toggle LED:', error)
    }
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Sensory Feedback App</h1>
      <div className="card">
        {!isConnected ? (
          <button onClick={handleConnect}>
            Connect to Device
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <button onClick={handleDisconnect}>
              Disconnect
            </button>
            
            <div>
              <h2>Sensor Value</h2>
              <p style={{ fontSize: '2em', fontWeight: 'bold' }}>{sensorValue}</p>
            </div>

            <div>
              <button onClick={toggleLed}>
                Turn LED {ledState ? 'OFF' : 'ON'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
