import { useState, useRef, useEffect, useCallback } from 'react';
import { saveRecording } from '@/services/db';

export function useRecording() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordedDataRef = useRef<{ time: number; values: number[] }[]>([]);
  const frameCounterRef = useRef(0);
  // Use ref for start time to avoid stale closure issues in setInterval
  const startTimeRef = useRef<number | null>(null);

  // Manage recording timer — ref-based to avoid closure staleness
  useEffect(() => {
    if (!isRecording) {
      setRecordingDuration(0);
      return;
    }

    // Tick immediately so timer shows 0:01 after 1 second
    const interval = setInterval(() => {
      if (startTimeRef.current != null) {
        setRecordingDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 500); // update every 500ms for snappier display

    return () => clearInterval(interval);
  }, [isRecording]);

  const captureFrame = useCallback((sensorData: number[]) => {
      if (isRecording && startTimeRef.current != null) {
            frameCounterRef.current = (frameCounterRef.current + 1) % 2;

            if (frameCounterRef.current === 0) {
                 recordedDataRef.current.push({
                    time: Date.now() - startTimeRef.current,
                    values: sensorData
                });
            }
        } else {
             frameCounterRef.current = 0;
        }
  }, [isRecording]);

  const toggleRecording = useCallback(async () => {
      if (isRecording) {
          // STOP RECORDING
          setIsRecording(false);
          startTimeRef.current = null;

          try {
            // Generate CSV content
            // Sensor Order: 0:Right Front, 1:Left Front, 2:Right Back, 3:Left Back
            const headers = "time_ms,right_front,left_front,right_back,left_back\n";
            const rows = recordedDataRef.current.map(d => 
                `${d.time},${d.values.join(',')}`
            ).join('\n');
            const csvContent = headers + rows;

            // Save to IndexedDB
            await saveRecording(recordingDuration, csvContent);
            console.log("Recording saved to DB successfully");
            
            // Optional: Still allow download? For now, we just save to DB as requested.
            // If you want download + DB, uncomment this section:
            /*
            const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `sensor-recording-${new Date().toISOString()}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            */
          } catch (error) {
            console.error("Failed to save recording:", error);
            alert("Failed to save recording!");
          }
          
          // Clear buffer
          recordedDataRef.current = [];
      } else {
          // START RECORDING
          startTimeRef.current = Date.now();
          setIsRecording(true);
          recordedDataRef.current = [];
      }
  }, [isRecording, recordingDuration]);

  return {
      isRecording,
      recordingDuration,
      toggleRecording,
      captureFrame
  };
}
