// ============================================================================
// PID Control Simulation — Type Definitions
// Enterprise-grade type system for real-time control simulation
// ============================================================================

// ---------------------------------------------------------------------------
// Robot Taxonomy — Plant Dynamics Archetypes
// ---------------------------------------------------------------------------

export type RobotCategory =
  | 'mobile_terrestrial'
  | 'underactuated_balancing'
  | 'aerial_spatial'
  | 'articulated_manipulator'
  | 'marine_aquatic'
  | 'custom';

export type RobotType =
  | 'line_follower'
  | 'ackermann_vehicle'
  | 'mecanum_platform'
  | 'self_balancing'
  | 'gantry_crane'
  | 'quadcopter'
  | 'vtol_birotor'
  | 'single_joint'
  | 'scara_arm'
  | 'underwater_rov'
  | 'custom_plant';

export interface RobotDefinition {
  id: RobotType;
  name: string;
  category: RobotCategory;
  description: string;
  icon: string;
  defaultPlant: PlantParameters;
  controlVariable: string;
  controlUnit: string;
  outputVariable: string;
  outputUnit: string;
  setpointRange: [number, number];
  defaultSetpoint: number;
  animationHint: string;
  /** Preset tuning profiles for layman users */
  presets?: PresetProfile[];
  /** Default PID configuration for archetype */
  defaultPID?: Partial<PIDConfig>;
  /** Per-archetype output divergence ceiling (auto-catch runaway) */
  divergenceLimit?: number;
  /** Whether gravity term uses radians internally (true) or degrees (false) */
  gravityInRadians?: boolean;
}

// ---------------------------------------------------------------------------
// Plant Transfer Function Parameters
// ---------------------------------------------------------------------------

export interface PlantParameters {
  /** Plant static gain K */
  gain: number;
  /** Time constant τ (seconds) */
  timeConstant: number;
  /** Damping ratio ζ */
  dampingRatio: number;
  /** Natural frequency ωn (rad/s) */
  naturalFrequency: number;
  /** Dead time / transport delay L (seconds) */
  deadTime: number;
  /** Plant order (1 or 2) */
  order: 1 | 2;
  /** Non-linear friction coefficient (0..1) */
  friction: number;
  /** Gravity torque factor */
  gravityTorque: number;
  /** Actuator saturation limits */
  actuatorLimits: [number, number];
  /** Mass m (kg) for thrust-model integrating plants (e.g. quadcopter) */
  mass?: number;
  /** Linear aerodynamic drag coefficient c (N·s/m) */
  dragCoefficient?: number;
  /** Gravity acceleration g (m/s²), defaults to 9.81 when mass is set */
  gravityAccel?: number;
}

// ---------------------------------------------------------------------------
// PID Controller Configuration
// ---------------------------------------------------------------------------

export interface PIDGains {
  Kp: number;
  Ki: number;
  Kd: number;
  /** Optional setpoint weighting factor b on P-term (default 1.0) */
  setpointWeight?: number;
}

export interface PIDConfig extends PIDGains {
  /** Derivative filter coefficient N */
  derivativeFilterN: number;
  /** Anti-windup: integrator clamp limits */
  integralClamp: [number, number];
  /** Use derivative-on-measurement instead of derivative-on-error */
  derivativeOnMeasurement: boolean;
  /** Anti-windup back-calculation coefficient Kb */
  antiWindupKb: number;
  /** Sampling period dt (seconds) */
  dt: number;
}

// ---------------------------------------------------------------------------
// Controller Internal State
// ---------------------------------------------------------------------------

export interface ControllerState {
  /** Current error e[k] */
  error: number;
  /** Previous error e[k-1] */
  prevError: number;
  /** Integral accumulator */
  integral: number;
  /** Previous measurement (for derivative-on-measurement) */
  prevMeasurement: number;
  /** Filtered derivative term */
  filteredDerivative: number;
  /** Raw P-term contribution */
  pTerm: number;
  /** Raw I-term contribution */
  iTerm: number;
  /** Raw D-term contribution */
  dTerm: number;
  /** Total control output u[k] */
  controlOutput: number;
  /** Control output before saturation */
  controlOutputUnsat: number;
  /** Whether integrator is currently saturated */
  isSaturated: boolean;
}

// ---------------------------------------------------------------------------
// Simulation State
// ---------------------------------------------------------------------------

export interface SimulationState {
  /** Current simulation time (seconds) */
  time: number;
  /** Process variable (plant output) */
  processVariable: number;
  /** Setpoint */
  setpoint: number;
  /** Control effort */
  controlEffort: number;
  /** Error signal */
  error: number;
  /** Controller state breakdown */
  controller: ControllerState;
  /** Plant internal state */
  plantState: PlantState;
  /** Is simulation running */
  isRunning: boolean;
  /** Simulation speed multiplier */
  speedMultiplier: number;
}

export interface PlantState {
  /** Internal integrator state variable(s) — NEVER overwrite with delayed output */
  x: number[];
  /** Measured output (after dead time + noise) — what PID actually reads */
  measuredOutput: number;
  /** Output history for dead-time: circular buffer (mutated in-place, never copied) */
  deadTimeBuffer: Float64Array;
  /** Dead-time buffer write index */
  deadTimeIndex: number;
  /** Dead-time buffer capacity */
  deadTimeCapacity: number;
}

// ---------------------------------------------------------------------------
// Time-Series Data for Plotting
// ---------------------------------------------------------------------------

export interface DataPoint {
  time: number;
  setpoint: number;
  processVariable: number;
  controlEffort: number;
  error: number;
  pTerm: number;
  iTerm: number;
  dTerm: number;
}

// ---------------------------------------------------------------------------
// Step Response Telemetry / Performance Metrics
// ---------------------------------------------------------------------------

export interface StepResponseMetrics {
  /** Rise time: 10% → 90% of final value (seconds) */
  riseTime: number | null;
  /** Peak overshoot as percentage */
  peakOvershoot: number | null;
  /** Settling time to 2% band (seconds) */
  settlingTime: number | null;
  /** Steady-state error */
  steadyStateError: number | null;
  /** Peak time (time of first peak) */
  peakTime: number | null;
  /** Peak value */
  peakValue: number | null;
  /** Oscillation frequency (Hz), if detected */
  oscillationFrequency: number | null;
  /** Stability indicator */
  isStable: boolean;
  /** Damping assessment */
  dampingAssessment: 'overdamped' | 'critically_damped' | 'underdamped' | 'unstable' | 'unknown';
  /** Detected sustained oscillation (undamped limit cycle / divergent) */
  sustainedOscillation?: boolean;
  /** Settling evaluation status */
  settlingStatus?: 'settled' | 'unsettled' | 'insufficient_data';
  /** Fraction of samples where control effort was saturated (0..1) */
  saturationFraction?: number;
  /** Whether the setpoint transition has a valid non-zero step amplitude (|SP - initial| >= threshold) */
  isStepValid?: boolean;
  /** Step amplitude magnitude |SP - initialValue| */
  stepAmplitude?: number;
}

// ---------------------------------------------------------------------------
// Auto-Tuning
// ---------------------------------------------------------------------------

export type TuningMethod =
  | 'ziegler_nichols'
  | 'cohen_coon'
  | 'itae_optimal'
  | 'numerical_optimization'
  | 'pole_placement';

export type CostProfile = 'aggressive' | 'balanced' | 'conservative';

export interface TuningResult {
  id?: string;
  method: TuningMethod;
  gains: PIDGains;
  predictedMetrics?: Partial<StepResponseMetrics>;
  cost?: number;
  confidence: number; // 0..1
  recommendation: string;
}

export interface TuningRecommendation {
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  suggestedGains?: Partial<PIDGains>;
  suggestedAction?: string;
}

export interface OptimizationConfig {
  /** Cost weights: [error², control², control_rate²] */
  weights: [number, number, number];
  /** Max iterations */
  maxIterations: number;
  /** Convergence tolerance */
  tolerance: number;
  /** Simulation horizon (seconds) */
  horizon: number;
}

// ---------------------------------------------------------------------------
// Simulation Status (Layman-Friendly State Machine)
// ---------------------------------------------------------------------------

export type SimulationStatus =
  | 'idle'       // Not started
  | 'running'    // Sim active, system healthy
  | 'stable'     // PV settled within 2% band
  | 'oscillating'// Underdamped, oscillation detected
  | 'runaway'    // Divergence detected — physics frozen
  | 'paused';    // User paused

// ---------------------------------------------------------------------------
// Signal Noise Configuration
// ---------------------------------------------------------------------------

export interface NoiseConfig {
  /** Enable Gaussian white noise on PV */
  enabled: boolean;
  /** Standard deviation σ of the noise */
  sigma: number;
  /** Simulated sensor latency samples (z^-k delay on measurement) */
  sensorDelaySamples?: number;
}

// ---------------------------------------------------------------------------
// Preset Profile (Zero-Math Quick Presets)
// ---------------------------------------------------------------------------

export interface PresetProfile {
  /** Display name (localized for layman) */
  name: string;
  /** Icon emoji */
  icon: string;
  /** Pre-tuned PID gains */
  gains: PIDGains;
  /** Short explanation in plain language */
  description: string;
}

// ---------------------------------------------------------------------------
// UI State
// ---------------------------------------------------------------------------

export type ViewportTab = 'oscilloscope' | 'animation';

export interface UIState {
  theme: 'dark' | 'light';
  activeViewport: ViewportTab;
  showPIDBreakdown: boolean;
  showMetrics: boolean;
  isMobile: boolean;
  isPanelCollapsed: boolean;
}

// ---------------------------------------------------------------------------
// Disturbance Event
// ---------------------------------------------------------------------------

export interface DisturbanceEvent {
  time: number;
  magnitude: number;
  duration: number;
  type: 'impulse' | 'step' | 'ramp';
}
