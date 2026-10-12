import { getAllTuningResults } from '../lib/tuner';
import { PlantParameters, PIDConfig } from '../types/simulation';

self.onmessage = (e: MessageEvent<{ plant: PlantParameters; setpoint: number; pidConfig: PIDConfig }>) => {
  const { plant, setpoint, pidConfig } = e.data;
  try {
    const results = getAllTuningResults(plant, setpoint, pidConfig);
    self.postMessage({ type: 'SUCCESS', results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: 'ERROR', error: message });
  }
};
