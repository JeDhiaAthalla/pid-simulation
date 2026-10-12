// ============================================================================
// Tuner Service — Web Worker Delegator with Graceful Main-Thread Fallback
// Isolates heavy grid-search & numerical optimization from the 60/120 FPS UI loop
// ============================================================================

import { PlantParameters, PIDConfig, TuningResult } from '@/types/simulation';
import { getAllTuningResults } from './tuner';

let tunerWorker: Worker | null = null;

/**
 * Runs tuning algorithms in a dedicated background Web Worker thread.
 * If Web Workers are unavailable or initialization fails, gracefully falls back to local computation.
 */
export function runTunerInWorker(
  plant: PlantParameters,
  setpoint: number,
  pidConfig: PIDConfig
): Promise<TuningResult[]> {
  return new Promise((resolve, reject) => {
    // 1. SSR / Node.js environment fallback
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      try {
        const results = getAllTuningResults(plant, setpoint, pidConfig);
        resolve(results);
      } catch (err) {
        reject(err);
      }
      return;
    }

    // 2. Client-side Web Worker execution
    try {
      if (!tunerWorker) {
        tunerWorker = new Worker(new URL('../workers/tuner.worker.ts', import.meta.url));
      }

      const handleMessage = (e: MessageEvent) => {
        tunerWorker?.removeEventListener('message', handleMessage);
        tunerWorker?.removeEventListener('error', handleError);
        if (e.data?.type === 'SUCCESS') {
          resolve(e.data.results);
        } else {
          console.warn('Tuner worker returned error, using fallback:', e.data?.error);
          resolve(getAllTuningResults(plant, setpoint, pidConfig));
        }
      };

      const handleError = (err: ErrorEvent) => {
        tunerWorker?.removeEventListener('message', handleMessage);
        tunerWorker?.removeEventListener('error', handleError);
        console.warn('Worker error event triggered, using fallback:', err.message);
        try {
          resolve(getAllTuningResults(plant, setpoint, pidConfig));
        } catch (e) {
          reject(e);
        }
      };

      tunerWorker.addEventListener('message', handleMessage);
      tunerWorker.addEventListener('error', handleError);
      tunerWorker.postMessage({ plant, setpoint, pidConfig });
    } catch (workerInitErr) {
      console.warn('Worker initialization failed, using microtask fallback:', workerInitErr);
      setTimeout(() => {
        try {
          resolve(getAllTuningResults(plant, setpoint, pidConfig));
        } catch (err) {
          reject(err);
        }
      }, 0);
    }
  });
}
