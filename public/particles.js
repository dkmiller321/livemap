// Particles on one canvas: one per drawn call, at most 150 in flight, plus ring pulses for agent and tool steps.

export const MAX_PARTICLES = 150;
export const MIN_TRAVEL_MS = 300;
export const MAX_TRAVEL_MS = 2000;
const PULSE_MS = 700;

/** @type {Record<string, string>} */
const COLORS = {
  http: '#2563eb',
  db: '#059669',
  llm: '#7c3aed',
  agent: '#d97706',
  tool: '#db2777',
  queue: '#0891b2',
};
const ERROR_COLOR = '#dc2626';

/**
 * @typedef {object} Particle
 * @property {string} edgeId
 * @property {number} x1
 * @property {number} y1
 * @property {number} x2
 * @property {number} y2
 * @property {number} start performance.now() at spawn
 * @property {number} travel ms
 * @property {number} count spans carried
 * @property {string} color
 */

/**
 * @typedef {object} Pulse
 * @property {number} x
 * @property {number} y
 * @property {number} start
 * @property {string} color
 */

/**
 * @param {number} ms
 */
export function travelTime(ms) {
  return Math.min(MAX_TRAVEL_MS, Math.max(MIN_TRAVEL_MS, ms));
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{area: () => {width: number, height: number}}} geometry
 */
export function createParticles(canvas, geometry) {
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  /** @type {Particle[]} */
  let particles = [];
  /** @type {Pulse[]} */
  let pulses = [];
  const counters = { maxActiveParticles: 0, particlesSpawned: 0, particlesMerged: 0, pulsesSpawned: 0, fps: 0 };
  let frozen = false;
  let frozenAt = 0;
  let frames = 0;
  let frameWindowStart = performance.now();

  /** @param {number} now */
  function prune(now) {
    particles = particles.filter((p) => p.start + p.travel > now);
    pulses = pulses.filter((p) => p.start + PULSE_MS > now);
  }

  function clock() {
    return frozen ? frozenAt : performance.now();
  }

  function resize() {
    const { width, height } = geometry.area();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height };
  }

  /** @param {number} now */
  function frame(now) {
    frames++;
    if (now - frameWindowStart >= 1000) {
      counters.fps = Math.round((frames * 1000) / (now - frameWindowStart));
      frames = 0;
      frameWindowStart = now;
    }
    const t = clock();
    prune(t);
    const { width, height } = resize();
    ctx.clearRect(0, 0, width, height);
    for (const p of particles) {
      const f = Math.min(1, Math.max(0, (t - p.start) / p.travel));
      const x = p.x1 + (p.x2 - p.x1) * f;
      const y = p.y1 + (p.y2 - p.y1) * f;
      const r = 3.5 + Math.min(7, Math.log2(p.count) * 1.6);
      ctx.beginPath();
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 0.92;
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (p.count > 1) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 9px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.count > 99 ? '99+' : String(p.count), x, y + 0.5);
      }
    }
    for (const p of pulses) {
      const f = (t - p.start) / PULSE_MS;
      ctx.beginPath();
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - f);
      ctx.lineWidth = 3;
      ctx.arc(p.x, p.y, 22 + f * 22, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    /**
     * Starts a particle for one call, or folds it into one already in flight (M6).
     * @param {{edgeId: string, x1: number, y1: number, x2: number, y2: number, durationMs: number, kind: string, error: boolean}} call
     */
    spawn(call) {
      const now = clock();
      prune(now);
      if (particles.length >= MAX_PARTICLES) {
        let host = null;
        for (let i = particles.length - 1; i >= 0; i--) {
          if (particles[i].edgeId === call.edgeId) {
            host = particles[i];
            break;
          }
        }
        if (host) {
          host.count++;
          if (call.error) host.color = ERROR_COLOR;
          counters.particlesMerged++;
          return;
        }
        particles.shift();
      }
      particles.push({
        edgeId: call.edgeId,
        x1: call.x1,
        y1: call.y1,
        x2: call.x2,
        y2: call.y2,
        start: now,
        travel: travelTime(call.durationMs),
        count: 1,
        color: call.error ? ERROR_COLOR : COLORS[call.kind] ?? '#525252',
      });
      counters.particlesSpawned++;
      counters.maxActiveParticles = Math.max(counters.maxActiveParticles, particles.length);
    },
    /**
     * A ring pulse on a node, for an agent or tool step.
     * @param {{x: number, y: number, kind: string, error: boolean, animate: boolean}} p
     */
    pulse(p) {
      counters.pulsesSpawned++;
      if (!p.animate) return;
      pulses.push({ x: p.x, y: p.y, start: clock(), color: p.error ? ERROR_COLOR : COLORS[p.kind] ?? '#525252' });
    },
    /** @param {boolean} on */
    freeze(on) {
      if (on === frozen) return;
      if (on) {
        frozenAt = performance.now();
        frozen = true;
      } else {
        const paused = performance.now() - frozenAt;
        for (const p of particles) p.start += paused;
        for (const p of pulses) p.start += paused;
        frozen = false;
      }
    },
    reset() {
      particles = [];
      pulses = [];
      counters.maxActiveParticles = 0;
      counters.particlesSpawned = 0;
      counters.particlesMerged = 0;
      counters.pulsesSpawned = 0;
    },
    stats() {
      prune(clock());
      return { ...counters, activeParticles: particles.length };
    },
  };
}
