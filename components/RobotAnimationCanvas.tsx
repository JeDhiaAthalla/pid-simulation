// ============================================================================
// RobotAnimationCanvas — Real-Time 2D Physics Visualization
// Kinematic & dynamic rendering synchronized with simulation clock
// ============================================================================

'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import { RobotType } from '@/types/simulation';

interface RobotAnimationCanvasProps {
  robotType: RobotType;
  processVariable: number;
  setpoint: number;
  controlEffort: number;
  time: number;
  isDark: boolean;
  onDisturbance: () => void;
}

const PALETTE = {
  dark: {
    bg: '#0A0F1A',
    ground: '#1E293B',
    groundLine: '#334155',
    metal: '#94A3B8',
    metalDark: '#475569',
    accent: '#22D3EE',
    accentGlow: 'rgba(34, 211, 238, 0.3)',
    warning: '#FBBF24',
    danger: '#F87171',
    success: '#22C55E',
    water: '#0E4DA4',
    waterLight: '#1E6FD9',
    sky: '#0F172A',
    text: '#CBD5E1',
    particle: '#22C55E',
  },
  light: {
    bg: '#F1F5F9',
    ground: '#E2E8F0',
    groundLine: '#CBD5E1',
    metal: '#475569',
    metalDark: '#1E293B',
    accent: '#0891B2',
    accentGlow: 'rgba(8, 145, 178, 0.2)',
    warning: '#D97706',
    danger: '#DC2626',
    success: '#16A34A',
    water: '#3B82F6',
    waterLight: '#60A5FA',
    sky: '#F8FAFC',
    text: '#334155',
    particle: '#16A34A',
  },
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

// Persistent particles across frames
let particles: Particle[] = [];

function spawnParticles(x: number, y: number, count: number, spread: number, vy: number) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x: x + (Math.random() - 0.5) * spread,
      y: y + (Math.random() - 0.5) * spread * 0.3,
      vx: (Math.random() - 0.5) * 30,
      vy: vy + (Math.random() - 0.5) * 20,
      life: 1,
      maxLife: 0.5 + Math.random() * 0.5,
      size: 1 + Math.random() * 2,
    });
  }
}

function updateParticles(dt: number) {
  particles = particles.filter((p) => p.life > 0);
  for (const p of particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 50 * dt; // gravity
    p.life -= dt / p.maxLife;
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, color: string) {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export default function RobotAnimationCanvas({
  robotType,
  processVariable,
  setpoint,
  controlEffort,
  time,
  isDark,
  onDisturbance,
}: RobotAnimationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 600, height: 400 });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = sizeRef.current.width;
    const h = sizeRef.current.height;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const c = isDark ? PALETTE.dark : PALETTE.light;

    // Background
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, w, h);

    updateParticles(0.016);

    // Dispatch to specific renderer
    switch (robotType) {
      case 'line_follower':
        drawLineFollower(ctx, w, h, c, processVariable, setpoint, controlEffort, time);
        break;
      case 'ackermann_vehicle':
        drawAckermannVehicle(ctx, w, h, c, processVariable, setpoint, controlEffort, time);
        break;
      case 'mecanum_platform':
        drawMecanumPlatform(ctx, w, h, c, processVariable, setpoint, controlEffort, time);
        break;
      case 'self_balancing':
        drawSelfBalancing(ctx, w, h, c, processVariable, setpoint, controlEffort, time);
        break;
      case 'gantry_crane':
        drawGantryCrane(ctx, w, h, c, processVariable, setpoint, controlEffort, time);
        break;
      case 'quadcopter':
        drawQuadcopter(ctx, w, h, c, processVariable, setpoint, controlEffort, time);
        break;
      case 'vtol_birotor':
        drawVTOL(ctx, w, h, c, processVariable, setpoint, controlEffort, time);
        break;
      case 'single_joint':
        drawSingleJoint(ctx, w, h, c, processVariable, setpoint, controlEffort, time);
        break;
      case 'scara_arm':
        drawSCARA(ctx, w, h, c, processVariable, setpoint, controlEffort, time);
        break;
      case 'underwater_rov':
        drawROV(ctx, w, h, c, processVariable, setpoint, controlEffort, time);
        break;
      default:
        drawCustomPlant(ctx, w, h, c, processVariable, setpoint, controlEffort, time);
    }

    drawParticles(ctx, c.particle);

    // Telemetry overlay
    ctx.fillStyle = c.text;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`PV: ${processVariable.toFixed(3)}`, 10, h - 30);
    ctx.fillText(`SP: ${setpoint.toFixed(3)}`, 10, h - 16);
    ctx.textAlign = 'right';
    ctx.fillText(`t: ${time.toFixed(2)}s`, w - 10, h - 16);

    // Click-to-disturb hint
    ctx.fillStyle = isDark ? 'rgba(251, 191, 36, 0.4)' : 'rgba(217, 119, 6, 0.4)';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('⚡ Click to inject disturbance', w / 2, h - 6);
  }, [robotType, processVariable, setpoint, controlEffort, time, isDark]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        sizeRef.current = {
          width: Math.max(200, Math.floor(entry.contentRect.width)),
          height: Math.max(150, Math.floor(entry.contentRect.height)),
        };
        draw();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [draw]);

  useEffect(() => { draw(); }, [draw]);

  return (
    <div ref={containerRef} className="w-full h-full min-h-[250px] relative cursor-pointer" onClick={onDisturbance}>
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}

// ============================================================================
// Robot-Specific Renderers
// ============================================================================

type Colors = typeof PALETTE.dark;

// ── Line Follower ──
function drawLineFollower(
  ctx: CanvasRenderingContext2D, w: number, h: number, c: Colors,
  pv: number, sp: number, u: number, t: number
) {
  const groundY = h * 0.7;

  // Ground
  ctx.fillStyle = c.ground;
  ctx.fillRect(0, groundY, w, h - groundY);
  ctx.strokeStyle = c.groundLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(w, groundY);
  ctx.stroke();

  // Track line (wandering path)
  ctx.strokeStyle = c.warning;
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 6]);
  ctx.beginPath();
  const trackCenterX = w / 2;
  for (let x = 0; x < w; x += 5) {
    const trackY = groundY - 2 + Math.sin((x + t * 60) * 0.02) * 15;
    if (x === 0) ctx.moveTo(x, trackY);
    else ctx.lineTo(x, trackY);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Robot body
  const robotX = w / 2 + pv * 5;
  const robotY = groundY - 18;
  const bodyW = 50;
  const bodyH = 20;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(robotX - bodyW / 2 + 3, robotY + 3, bodyW, bodyH);

  // Body
  ctx.fillStyle = c.metalDark;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(robotX - bodyW / 2, robotY, bodyW, bodyH, 4);
  ctx.fill();
  ctx.stroke();

  // Sensor array (IR sensors at front)
  for (let i = -2; i <= 2; i++) {
    ctx.fillStyle = i === 0 ? c.success : c.accent;
    ctx.beginPath();
    ctx.arc(robotX + i * 6, robotY + bodyH + 3, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Wheels
  ctx.fillStyle = c.metal;
  ctx.beginPath();
  ctx.arc(robotX - bodyW / 2 + 8, robotY + bodyH, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(robotX + bodyW / 2 - 8, robotY + bodyH, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Wheel rotation indicator
  const wheelAngle = t * 10;
  for (const wheelX of [robotX - bodyW / 2 + 8, robotX + bodyW / 2 - 8]) {
    ctx.strokeStyle = c.metalDark;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(wheelX + Math.cos(wheelAngle) * 4, robotY + bodyH + Math.sin(wheelAngle) * 4);
    ctx.lineTo(wheelX - Math.cos(wheelAngle) * 4, robotY + bodyH - Math.sin(wheelAngle) * 4);
    ctx.stroke();
  }

  // Error visualization
  const errMag = pv - sp;
  if (Math.abs(errMag) > 0.1) {
    ctx.strokeStyle = c.danger;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(robotX, robotY);
    ctx.lineTo(robotX - errMag * 5, robotY - 15);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = c.danger;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`e=${errMag.toFixed(2)}`, robotX, robotY - 20);
  }

  // Title
  ctx.fillStyle = c.text;
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('LINE FOLLOWER — LATERAL TRACKING', w / 2, 18);
}

// ── Ackermann Vehicle (Cinematic Highway) ──
function drawAckermannVehicle(
  ctx: CanvasRenderingContext2D, w: number, h: number, c: Colors,
  pv: number, sp: number, u: number, t: number
) {
  const cx = w / 2;
  const cy = h / 2;
  const roadH = Math.min(180, h * 0.55);
  const roadTop = cy - roadH / 2;
  const roadBottom = cy + roadH / 2;
  const forwardSpeed = 280;

  // Outer dark terrain
  ctx.fillStyle = '#060B14';
  ctx.fillRect(0, 0, w, h);

  // Asphalt road surface
  const aspGrad = ctx.createLinearGradient(0, roadTop, 0, roadBottom);
  aspGrad.addColorStop(0, '#0D1117');
  aspGrad.addColorStop(0.5, '#161F2E');
  aspGrad.addColorStop(1, '#0D1117');
  ctx.fillStyle = aspGrad;
  ctx.fillRect(0, roadTop, w, roadH);

  // Road guardrails
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(0, roadTop); ctx.lineTo(w, roadTop);
  ctx.moveTo(0, roadBottom); ctx.lineTo(w, roadBottom);
  ctx.stroke();

  // Solid white shoulder lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, roadTop + 10); ctx.lineTo(w, roadTop + 10);
  ctx.moveTo(0, roadBottom - 10); ctx.lineTo(w, roadBottom - 10);
  ctx.stroke();

  // Center dashed dividing line (moving backward)
  ctx.strokeStyle = '#FBBF24';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([36, 28]);
  ctx.lineDashOffset = t * forwardSpeed;
  ctx.beginPath();
  ctx.moveTo(0, cy); ctx.lineTo(w, cy);
  ctx.stroke();
  ctx.setLineDash([]);

  // Car position
  const lateralY = Math.max(-roadH * 0.35, Math.min(roadH * 0.35, pv * 1.2));
  const carX = cx - 25;
  const carY = cy + lateralY;
  const heading = (pv * Math.PI) / 180;
  const steerAngle = Math.max(-0.55, Math.min(0.55, u));

  // Target trajectory arc
  const targetY = cy + Math.max(-roadH * 0.35, Math.min(roadH * 0.35, sp * 1.2));
  ctx.strokeStyle = c.warning;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(carX + 35, carY);
  ctx.lineTo(w, targetY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.save();
  ctx.translate(carX, carY);
  ctx.rotate(heading);

  // Volumetric Headlights
  for (const ly of [-12, 12]) {
    const hGrad = ctx.createRadialGradient(32, ly, 2, 120, ly, 90);
    hGrad.addColorStop(0, 'rgba(255, 255, 240, 0.85)');
    hGrad.addColorStop(0.2, 'rgba(251, 191, 36, 0.35)');
    hGrad.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = hGrad;
    ctx.beginPath();
    ctx.moveTo(32, ly - 3);
    ctx.lineTo(135, ly - 36);
    ctx.lineTo(135, ly + 36);
    ctx.lineTo(32, ly + 3);
    ctx.closePath();
    ctx.fill();
  }

  // Taillight trails
  ctx.fillStyle = 'rgba(239, 68, 68, 0.4)';
  ctx.fillRect(-85, -14, 55, 4);
  ctx.fillRect(-85, 10, 55, 4);

  // Wheels
  const wheelPositions = [
    { x: -22, y: -17, steer: false },
    { x: -22, y: 17, steer: false },
    { x: 22, y: -17, steer: true },
    { x: 22, y: 17, steer: true },
  ];

  for (const wp of wheelPositions) {
    ctx.save();
    ctx.translate(wp.x, wp.y);
    if (wp.steer) ctx.rotate(steerAngle);
    ctx.fillStyle = '#090D16';
    ctx.fillRect(-7, -4, 14, 8);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(-7, -4, 14, 8);
    ctx.restore();
  }

  // Car body
  ctx.fillStyle = '#1E293B';
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.roundRect(-30, -15, 62, 30, 6);
  ctx.fill();
  ctx.stroke();

  // Windshield
  ctx.fillStyle = c.accentGlow;
  ctx.beginPath();
  ctx.roundRect(-8, -11, 22, 22, 3);
  ctx.fill();

  ctx.restore();

  ctx.fillStyle = c.text;
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('ACKERMANN — HIGHWAY PURSUIT', w / 2, 20);
}

// ── Mecanum Platform ──
function drawMecanumPlatform(
  ctx: CanvasRenderingContext2D, w: number, h: number, c: Colors,
  pv: number, sp: number, u: number, t: number
) {
  const groundY = h * 0.7;
  ctx.fillStyle = c.ground;
  ctx.fillRect(0, groundY, w, h - groundY);

  // Grid floor
  ctx.strokeStyle = c.groundLine;
  ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += 30) {
    ctx.beginPath(); ctx.moveTo(x, groundY); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = groundY; y < h; y += 30) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  const cx = w / 2 + pv * 20;
  const cy = groundY - 30;

  // Platform
  ctx.fillStyle = c.metalDark;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(cx - 35, cy - 25, 70, 50, 8);
  ctx.fill();
  ctx.stroke();

  // Mecanum wheels (X pattern)
  const wheels = [
    { x: cx - 35, y: cy - 25 },
    { x: cx + 25, y: cy - 25 },
    { x: cx - 35, y: cy + 15 },
    { x: cx + 25, y: cy + 15 },
  ];
  for (const wh of wheels) {
    ctx.fillStyle = c.metal;
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(wh.x, wh.y, 12, 10, 2);
    ctx.fill();
    ctx.stroke();

    // Roller pattern
    ctx.strokeStyle = c.metalDark;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(wh.x + 2 + i * 4, wh.y);
      ctx.lineTo(wh.x + 4 + i * 4, wh.y + 10);
      ctx.stroke();
    }
  }

  // Target marker
  const targetX = w / 2 + sp * 20;
  ctx.strokeStyle = c.warning;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(targetX, cy, 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(targetX - 8, cy);
  ctx.lineTo(targetX + 8, cy);
  ctx.moveTo(targetX, cy - 8);
  ctx.lineTo(targetX, cy + 8);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = c.text;
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('MECANUM — HOLONOMIC POSITIONING', w / 2, 18);
}

// ── Self-Balancing Robot ──
function drawSelfBalancing(
  ctx: CanvasRenderingContext2D, w: number, h: number, c: Colors,
  pv: number, sp: number, u: number, t: number
) {
  const groundY = h * 0.8;
  ctx.fillStyle = c.ground;
  ctx.fillRect(0, groundY, w, h - groundY);
  ctx.strokeStyle = c.groundLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(w, groundY);
  ctx.stroke();

  const cx = w / 2;
  const wheelY = groundY - 12;
  const tiltAngle = pv * Math.PI / 180;
  const bodyLength = Math.min(h * 0.35, 120);

  // Wheel axle
  ctx.fillStyle = c.metal;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;

  // Left wheel
  ctx.beginPath();
  ctx.arc(cx - 18, wheelY, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Right wheel
  ctx.beginPath();
  ctx.arc(cx + 18, wheelY, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Wheel spokes
  const spoke = t * 5;
  for (const wheelCx of [cx - 18, cx + 18]) {
    ctx.strokeStyle = c.metalDark;
    ctx.lineWidth = 1;
    for (let a = 0; a < 4; a++) {
      const angle = spoke + (a * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(wheelCx, wheelY);
      ctx.lineTo(wheelCx + Math.cos(angle) * 9, wheelY + Math.sin(angle) * 9);
      ctx.stroke();
    }
  }

  // Body (tilting pendulum)
  ctx.save();
  ctx.translate(cx, wheelY);
  ctx.rotate(tiltAngle);

  // Main body rectangle
  ctx.fillStyle = c.metalDark;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-12, -bodyLength, 24, bodyLength, 4);
  ctx.fill();
  ctx.stroke();

  // Head unit
  ctx.fillStyle = c.accentGlow;
  ctx.beginPath();
  ctx.roundRect(-10, -bodyLength - 8, 20, 12, 6);
  ctx.fill();

  // Eyes
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.arc(-4, -bodyLength - 2, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(4, -bodyLength - 2, 2, 0, Math.PI * 2);
  ctx.fill();

  // Center of mass marker
  ctx.fillStyle = c.danger;
  ctx.beginPath();
  ctx.arc(0, -bodyLength * 0.6, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Gravity arrow
  ctx.strokeStyle = c.danger;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  const comX = cx + Math.sin(tiltAngle) * bodyLength * 0.6;
  const comY = wheelY - Math.cos(tiltAngle) * bodyLength * 0.6;
  ctx.beginPath();
  ctx.moveTo(comX, comY);
  ctx.lineTo(comX, comY + 25);
  ctx.stroke();
  // Arrowhead
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(comX, comY + 25);
  ctx.lineTo(comX - 4, comY + 20);
  ctx.moveTo(comX, comY + 25);
  ctx.lineTo(comX + 4, comY + 20);
  ctx.stroke();

  ctx.fillStyle = c.danger;
  ctx.font = '8px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('g', comX + 6, comY + 20);

  // Tilt angle readout
  ctx.fillStyle = c.accent;
  ctx.font = 'bold 12px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`θ = ${pv.toFixed(2)}°`, cx, 40);

  ctx.fillStyle = c.text;
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.fillText('SELF-BALANCING — INVERTED PENDULUM', w / 2, 18);
}

// ── Gantry Crane / Cart-Pole ──
function drawGantryCrane(
  ctx: CanvasRenderingContext2D, w: number, h: number, c: Colors,
  pv: number, sp: number, u: number, t: number
) {
  const railY = h * 0.25;
  const cartW = 60;
  const cartH = 25;
  const cableLen = Math.min(h * 0.35, 130);

  // Rail
  ctx.strokeStyle = c.metalDark;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(30, railY);
  ctx.lineTo(w - 30, railY);
  ctx.stroke();

  // Rail supports
  ctx.strokeStyle = c.groundLine;
  ctx.lineWidth = 2;
  for (const x of [50, w - 50]) {
    ctx.beginPath();
    ctx.moveTo(x, railY);
    ctx.lineTo(x, h * 0.85);
    ctx.stroke();
  }

  // Cart position
  const cartX = w / 2 + pv * 30;
  const cartY = railY;

  // Cart
  ctx.fillStyle = c.metalDark;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(cartX - cartW / 2, cartY, cartW, cartH, 3);
  ctx.fill();
  ctx.stroke();

  // Cart wheels on rail
  ctx.fillStyle = c.metal;
  ctx.beginPath();
  ctx.arc(cartX - cartW / 3, cartY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cartX + cartW / 3, cartY, 4, 0, Math.PI * 2);
  ctx.fill();

  // Pendulum cable
  const swayAngle = Math.sin(t * 3 + pv * 0.1) * 0.15 * (1 + Math.abs(u) * 0.05);
  const bobX = cartX + Math.sin(swayAngle) * cableLen;
  const bobY = cartY + cartH + Math.cos(swayAngle) * cableLen;

  ctx.strokeStyle = c.metal;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cartX, cartY + cartH);
  ctx.lineTo(bobX, bobY);
  ctx.stroke();

  // Payload
  ctx.fillStyle = c.warning;
  ctx.strokeStyle = c.metalDark;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(bobX, bobY, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Target position
  const targetX = w / 2 + sp * 30;
  ctx.strokeStyle = c.success;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(targetX, railY);
  ctx.lineTo(targetX, railY + cartH + cableLen + 20);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = c.text;
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('GANTRY CRANE — CART-POLE SWAY CONTROL', w / 2, 18);
}

// ── Quadcopter Drone ──
function drawQuadcopter(
  ctx: CanvasRenderingContext2D, w: number, h: number, c: Colors,
  pv: number, sp: number, u: number, t: number
) {
  // Sky gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, c.sky);
  grad.addColorStop(1, c.ground);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Ground
  ctx.fillStyle = c.ground;
  ctx.fillRect(0, h * 0.85, w, h * 0.15);

  // Altitude scale
  ctx.strokeStyle = c.groundLine;
  ctx.lineWidth = 0.5;
  ctx.fillStyle = c.text;
  ctx.font = '8px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';
  for (let alt = 0; alt <= 20; alt += 5) {
    const y = h * 0.85 - (alt / 20) * h * 0.7;
    ctx.beginPath();
    ctx.moveTo(25, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillText(`${alt}m`, 22, y + 3);
  }

  // Target altitude
  const targetY = h * 0.85 - (sp / 20) * h * 0.7;
  ctx.strokeStyle = c.warning;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(30, targetY);
  ctx.lineTo(w - 10, targetY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Drone position
  const droneY = h * 0.85 - (pv / 20) * h * 0.7;
  const droneX = w / 2;
  const tilt = Math.sin(t * 2) * 0.05;

  ctx.save();
  ctx.translate(droneX, droneY);
  ctx.rotate(tilt);

  // Arms
  ctx.strokeStyle = c.metalDark;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-40, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -3);
  ctx.lineTo(0, 3);
  ctx.stroke();

  // Body
  ctx.fillStyle = c.metalDark;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-12, -6, 24, 12, 4);
  ctx.fill();
  ctx.stroke();

  // LED
  ctx.fillStyle = Math.floor(t * 4) % 2 === 0 ? c.success : c.danger;
  ctx.beginPath();
  ctx.arc(0, -3, 2, 0, Math.PI * 2);
  ctx.fill();

  // Rotors
  const rotorSpeed = t * 30;
  for (const rx of [-40, 40]) {
    // Motor housing
    ctx.fillStyle = c.metal;
    ctx.beginPath();
    ctx.arc(rx, 0, 5, 0, Math.PI * 2);
    ctx.fill();

    // Rotor blur
    ctx.strokeStyle = `${c.accent}80`;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.ellipse(rx, 0, 18, 3, rotorSpeed + (rx > 0 ? 1 : 0), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // Thrust particles
  if (u > 0.5) {
    const particleCount = Math.floor(u * 0.3);
    spawnParticles(droneX - 40, droneY + 5, particleCount, 8, 30);
    spawnParticles(droneX + 40, droneY + 5, particleCount, 8, 30);
  }

  ctx.fillStyle = c.text;
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('QUADCOPTER — ALTITUDE CONTROL', w / 2, 18);

  ctx.fillStyle = c.accent;
  ctx.font = 'bold 12px "JetBrains Mono", monospace';
  ctx.fillText(`Alt: ${pv.toFixed(2)}m | Thrust: ${u.toFixed(1)}N`, w / 2, 36);
}

// ── VTOL / Bi-Rotor ──
function drawVTOL(
  ctx: CanvasRenderingContext2D, w: number, h: number, c: Colors,
  pv: number, sp: number, u: number, t: number
) {
  ctx.fillStyle = c.sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = c.ground;
  ctx.fillRect(0, h * 0.85, w, h * 0.15);

  const cx = w / 2;
  const cy = h * 0.45;
  const pitchAngle = pv * Math.PI / 180;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(pitchAngle);

  // Wings
  ctx.fillStyle = c.metalDark;
  ctx.beginPath();
  ctx.moveTo(-50, -3);
  ctx.lineTo(50, -3);
  ctx.lineTo(45, 5);
  ctx.lineTo(-45, 5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Fuselage
  ctx.fillStyle = c.metalDark;
  ctx.beginPath();
  ctx.ellipse(0, 0, 15, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = c.accent;
  ctx.stroke();

  // Rotors at wing tips
  const rotorTilt = u * 0.05;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * 45, -3);
    ctx.rotate(rotorTilt * side);

    ctx.strokeStyle = c.metal;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -12);
    ctx.stroke();

    ctx.strokeStyle = `${c.accent}80`;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.ellipse(0, -12, 16, 2, t * 20 + side, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  ctx.restore();

  ctx.fillStyle = c.text;
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('VTOL BI-ROTOR — PITCH STABILIZATION', w / 2, 18);
}

// ── Single Joint ──
function drawSingleJoint(
  ctx: CanvasRenderingContext2D, w: number, h: number, c: Colors,
  pv: number, sp: number, u: number, t: number
) {
  const cx = w / 2;
  const cy = h * 0.55;
  const armLen = Math.min(w * 0.25, h * 0.3, 120);

  // Base
  ctx.fillStyle = c.ground;
  ctx.fillRect(cx - 30, cy, 60, 20);
  ctx.strokeStyle = c.groundLine;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - 30, cy, 60, 20);

  // Hatch lines on base
  ctx.strokeStyle = c.groundLine;
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(cx - 25 + i * 10, cy + 20);
    ctx.lineTo(cx - 30 + i * 10, cy);
    ctx.stroke();
  }

  // Target angle ghost
  const targetRad = sp * Math.PI / 180;
  ctx.strokeStyle = c.warning;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(
    cx + Math.cos(-targetRad + Math.PI / 2) * armLen,
    cy - Math.sin(-targetRad + Math.PI / 2) * armLen
  );
  ctx.stroke();
  ctx.setLineDash([]);

  // Arm
  const angle = pv * Math.PI / 180;
  const endX = cx + Math.cos(-angle + Math.PI / 2) * armLen;
  const endY = cy - Math.sin(-angle + Math.PI / 2) * armLen;

  // Arm shadow
  ctx.strokeStyle = 'rgba(0,0,0,0.1)';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(cx + 2, cy + 2);
  ctx.lineTo(endX + 2, endY + 2);
  ctx.stroke();

  // Arm body
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  // Gradient overlay on arm
  ctx.strokeStyle = c.metalDark;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  // Joint hub
  ctx.fillStyle = c.metal;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Joint center dot
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();

  // End effector
  ctx.fillStyle = c.warning;
  ctx.strokeStyle = c.metalDark;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(endX, endY, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Angle arc
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, 30, -Math.PI / 2, -Math.PI / 2 + angle, angle > 0);
  ctx.stroke();

  ctx.fillStyle = c.accent;
  ctx.font = 'bold 12px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`θ = ${pv.toFixed(1)}°`, cx, cy + 50);

  ctx.fillStyle = c.text;
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.fillText('1-DOF JOINT — GRAVITY + FRICTION', w / 2, 18);
}

// ── SCARA Arm ──
function drawSCARA(
  ctx: CanvasRenderingContext2D, w: number, h: number, c: Colors,
  pv: number, sp: number, u: number, t: number
) {
  const cx = w * 0.35;
  const cy = h * 0.6;
  const L1 = Math.min(w * 0.18, 80);
  const L2 = Math.min(w * 0.15, 65);

  // Base
  ctx.fillStyle = c.ground;
  ctx.beginPath();
  ctx.roundRect(cx - 20, cy, 40, 15, 3);
  ctx.fill();
  ctx.strokeStyle = c.groundLine;
  ctx.stroke();

  // Angles based on PV (simplified IK)
  const theta1 = -Math.PI / 4 + (pv / 500) * Math.PI * 0.6;
  const theta2 = Math.PI / 3 + Math.sin(t * 0.5) * 0.2;

  const j1x = cx + Math.cos(theta1) * L1;
  const j1y = cy + Math.sin(theta1) * L1;
  const j2x = j1x + Math.cos(theta1 + theta2) * L2;
  const j2y = j1y + Math.sin(theta1 + theta2) * L2;

  // Target circle
  const targetNorm = sp / 500;
  const targetTheta = -Math.PI / 4 + targetNorm * Math.PI * 0.6;
  const tX = cx + Math.cos(targetTheta) * L1 + Math.cos(targetTheta + theta2) * L2;
  const tY = cy + Math.sin(targetTheta) * L1 + Math.sin(targetTheta + theta2) * L2;

  ctx.strokeStyle = c.warning;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(tX, tY, 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tX - 6, tY);
  ctx.lineTo(tX + 6, tY);
  ctx.moveTo(tX, tY - 6);
  ctx.lineTo(tX, tY + 6);
  ctx.stroke();
  ctx.setLineDash([]);

  // Link 1
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(j1x, j1y);
  ctx.stroke();

  // Link 2
  ctx.strokeStyle = c.metalDark;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(j1x, j1y);
  ctx.lineTo(j2x, j2y);
  ctx.stroke();

  // Joints
  for (const [jx, jy, r] of [[cx, cy, 8], [j1x, j1y, 6], [j2x, j2y, 5]] as [number, number, number][]) {
    ctx.fillStyle = c.metal;
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(jx, jy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // End effector trail
  ctx.fillStyle = c.accentGlow;
  ctx.beginPath();
  ctx.arc(j2x, j2y, 3, 0, Math.PI * 2);
  ctx.fill();

  // Workspace arc
  ctx.strokeStyle = `${c.accent}20`;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.arc(cx, cy, L1 + L2, -Math.PI, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, Math.abs(L1 - L2), -Math.PI, 0);
  ctx.stroke();

  ctx.fillStyle = c.text;
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('2-DOF SCARA — END-EFFECTOR TRACKING', w / 2, 18);
}

// ── Underwater ROV ──
function drawROV(
  ctx: CanvasRenderingContext2D, w: number, h: number, c: Colors,
  pv: number, sp: number, u: number, t: number
) {
  // Water gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, c.water);
  grad.addColorStop(1, '#021526');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Water surface
  ctx.strokeStyle = c.waterLight;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < w; x += 5) {
    const y = 20 + Math.sin((x + t * 50) * 0.03) * 5;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Depth lines
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 0.5;
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '8px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';
  for (let d = 0; d <= 50; d += 10) {
    const y = 30 + (d / 50) * (h - 50);
    ctx.beginPath();
    ctx.moveTo(25, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillText(`${d}m`, 22, y + 3);
  }

  // Target depth
  const targetY = 30 + (sp / 50) * (h - 50);
  ctx.strokeStyle = c.warning;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(30, targetY);
  ctx.lineTo(w - 10, targetY);
  ctx.stroke();
  ctx.setLineDash([]);

  // ROV position
  const rovY = 30 + (pv / 50) * (h - 50);
  const rovX = w / 2 + Math.sin(t * 0.7) * 10;

  // Tether cable
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w / 2, 25);
  ctx.bezierCurveTo(w / 2 + 20, rovY * 0.3, w / 2 - 15, rovY * 0.6, rovX, rovY - 15);
  ctx.stroke();

  // ROV body
  ctx.fillStyle = c.metalDark;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(rovX - 25, rovY - 12, 50, 24, 6);
  ctx.fill();
  ctx.stroke();

  // Viewport
  ctx.fillStyle = c.accentGlow;
  ctx.beginPath();
  ctx.arc(rovX + 12, rovY, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Light beam
  ctx.fillStyle = `rgba(34, 211, 238, ${0.05 + Math.sin(t * 3) * 0.02})`;
  ctx.beginPath();
  ctx.moveTo(rovX + 18, rovY - 3);
  ctx.lineTo(rovX + 80, rovY - 30);
  ctx.lineTo(rovX + 80, rovY + 24);
  ctx.closePath();
  ctx.fill();

  // Thrusters
  const thrusterPos = [
    { x: rovX - 25, y: rovY - 8 },
    { x: rovX - 25, y: rovY + 8 },
  ];
  for (const tp of thrusterPos) {
    ctx.fillStyle = c.metal;
    ctx.beginPath();
    ctx.roundRect(tp.x - 6, tp.y - 3, 6, 6, 1);
    ctx.fill();
  }

  // Bubbles
  if (Math.abs(u) > 0.5) {
    spawnParticles(rovX - 25, rovY, Math.floor(Math.abs(u) * 0.3), 8, -20);
  }

  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('UNDERWATER ROV — DEPTH CONTROL', w / 2, 14);
}

// ── Custom Plant ──
function drawCustomPlant(
  ctx: CanvasRenderingContext2D, w: number, h: number, c: Colors,
  pv: number, sp: number, u: number, t: number
) {
  const cx = w / 2;
  const cy = h / 2;

  // Abstract visualization: bar gauge
  const maxVal = Math.max(Math.abs(sp), Math.abs(pv), 1) * 1.5;
  const barW = Math.min(w * 0.5, 200);
  const barH = 20;

  // Background bar
  ctx.fillStyle = c.ground;
  ctx.beginPath();
  ctx.roundRect(cx - barW / 2, cy - barH / 2, barW, barH, 4);
  ctx.fill();

  // PV fill
  const pvFrac = (pv / maxVal) * 0.5 + 0.5;
  const pvW = pvFrac * barW;
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.roundRect(cx - barW / 2, cy - barH / 2, pvW, barH, 4);
  ctx.fill();

  // SP marker
  const spFrac = (sp / maxVal) * 0.5 + 0.5;
  const spX = cx - barW / 2 + spFrac * barW;
  ctx.strokeStyle = c.warning;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(spX, cy - barH / 2 - 5);
  ctx.lineTo(spX, cy + barH / 2 + 5);
  ctx.stroke();

  // Dial visualization below
  const dialR = Math.min(w * 0.15, h * 0.2, 60);
  const dialY = cy + 60;

  ctx.strokeStyle = c.groundLine;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, dialY, dialR, Math.PI * 0.8, Math.PI * 2.2);
  ctx.stroke();

  // PV needle
  const needleAngle = Math.PI * 0.8 + (pvFrac) * Math.PI * 1.4;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, dialY);
  ctx.lineTo(cx + Math.cos(needleAngle) * dialR * 0.85, dialY + Math.sin(needleAngle) * dialR * 0.85);
  ctx.stroke();

  // Center dot
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.arc(cx, dialY, 4, 0, Math.PI * 2);
  ctx.fill();

  // Transfer function block
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(cx - 45, cy - 80, 90, 35, 4);
  ctx.stroke();

  ctx.fillStyle = c.text;
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('G(s) = K·ωn²', cx, cy - 67);
  ctx.fillText('s²+2ζωns+ωn²', cx, cy - 54);

  // Arrows
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 80, cy - 63);
  ctx.lineTo(cx - 47, cy - 63);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + 47, cy - 63);
  ctx.lineTo(cx + 80, cy - 63);
  ctx.stroke();

  ctx.fillStyle = c.text;
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText('u(t)', cx - 50, cy - 58);
  ctx.textAlign = 'left';
  ctx.fillText('y(t)', cx + 50, cy - 58);

  ctx.fillStyle = c.text;
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('CUSTOM PLANT — TRANSFER FUNCTION', w / 2, 18);
}
