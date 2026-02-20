import { useState, useRef, useEffect, useCallback } from 'react';
import { saveRecording } from '@/services/db';

export function useRecording() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordedDataRef = useRef<{ time: number; values: number[] }[]>([]);
  const frameCounterRef = useRef(0);

  // Manage recording timer
  useEffect(() => {
    // Only lock scroll when recording? The original locked it always when mounted?
    // The original code:
    /*
      useEffect(() => {
        document.body.style.overflow = 'hidden';
        let recordingInterval...
        // ...
        return () => {
             document.body.style.overflow = '';
             clearInterval(recordingInterval);
        };
      }, [isRecording, recordingStartTime]);
    */
    // It seems it locked scroll only when the effect ran? No, useEffect runs on mount too.
    // Wait, the dependency array [isRecording, recordingStartTime] means it re-runs regularly.
    // If isRecording is false at start, scroll is hidden? Yes.
    // Then on clean up (unmount or change), it restores scroll.
    // I should probably check if I should keep the scroll locking behavior here or in the component.
    // The component is likely the best place for UI side effects like scroll locking.
    // I'll leave scroll locking out of the hook for now, or put it in the UI component.
    
    let recordingInterval: ReturnType<typeof setInterval>;

    if (isRecording && recordingStartTime) {
      recordingInterval = setInterval(() => {
        setRecordingDuration(Math.floor((Date.now() - recordingStartTime) / 1000));
      }, 1000);
    } else {
      setRecordingDuration(0);
    }

    return () => {
        clearInterval(recordingInterval);
    };
  }, [isRecording, recordingStartTime]);

  const captureFrame = useCallback((sensorData: number[]) => {
      if (isRecording && recordingStartTime != null) {
            frameCounterRef.current = (frameCounterRef.current + 1) % 2;
            
            if (frameCounterRef.current === 0) {
                 recordedDataRef.current.push({
                    time: Date.now() - recordingStartTime,
                    values: sensorData
                });
            }
        } else {
             frameCounterRef.current = 0; 
        }
  }, [isRecording, recordingStartTime]);

  const toggleRecording = useCallback(async () => {
      if (isRecording) {
          // STOP RECORDING
          setIsRecording(false);
          setRecordingStartTime(null);
          
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
          setIsRecording(true);
          setRecordingStartTime(Date.now());
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
