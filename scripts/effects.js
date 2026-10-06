/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Particle palettes per theme. Each colour becomes a pre-rendered glow sprite, so a frame draws images
 * instead of building gradients, which keeps a few hundred particles cheap.
 */
const PALETTES = {
  forge: {
    ember: ["#ffb347", "#ff7a18", "#ffd27f", "#ff5e00"],
    spark: ["#fff4d6", "#ffd27f", "#ffb347"],
    smoke: ["#5a5048", "#3d3833"],
    trail: ["#ffcf70", "#ff8c2a"],
    burst: ["#fff4d6", "#ffcf70", "#ff8c2a", "#ff5e00"]
  },
  arcane: {
    ember: ["#7fe8ff", "#4fb8ff", "#b28cff", "#e0f7ff"],
    spark: ["#e9fbff", "#7fe8ff", "#b28cff"],
    smoke: ["#3b2f6b", "#1f3e66"],
    trail: ["#a6f0ff", "#9d7bff"],
    burst: ["#ffffff", "#a6f0ff", "#4fb8ff", "#b28cff"]
  }
};

const SPRITE_SIZE = 64;
const spriteCache = new Map();

/**
 * A soft radial glow of one colour, drawn once and reused.
 * @param {string} color
 * @returns {HTMLCanvasElement}
 */
function sprite(color) {
  let s = spriteCache.get(color);
  if ( s ) return s;
  s = document.createElement("canvas");
  s.width = s.height = SPRITE_SIZE;
  const ctx = s.getContext("2d");
  const half = SPRITE_SIZE / 2;
  const g = ctx.createRadialGradient(half, half, 0, half, half, half);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.18, color);
  g.addColorStop(0.45, `${color}66`);
  g.addColorStop(1, `${color}00`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  spriteCache.set(color, s);
  return s;
}

const rand = (a, b) => a + (Math.random() * (b - a));
const pick = list => list[Math.floor(Math.random() * list.length)];

/**
 * The particle layer behind and above the crafting bench: ambient embers or motes, and the bursts,
 * trails and smoke the craft animations ask for.
 */
export class CraftFX {
  /** @param {string} theme */
  constructor(theme) {
    this.theme = theme;
    this.particles = [];
    this.canvas = null;
    this.ctx = null;
    this.frame = null;
    this.last = 0;
    this.ambientRate = 1;
  }

  /** The frame callback, bound once so every frame can re-schedule it. */
  #loop = now => this.#tick(now);

  /**
   * Bind to a (possibly new) canvas element. A re-render replaces the element; particles survive it.
   * @param {HTMLCanvasElement} canvas
   * @param {string} theme
   */
  attach(canvas, theme) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.theme = theme;
    this.resize();
    if ( !this.frame ) this.frame = requestAnimationFrame(this.#loop);
  }

  resize() {
    if ( !this.canvas ) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  stop() {
    if ( this.frame ) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.particles = [];
  }

  /**
   * A point on the canvas for the centre of an element.
   * @param {HTMLElement} el
   * @returns {{x: number, y: number}}
   */
  centerOf(el) {
    if ( !this.canvas ) return { x: 0, y: 0 };
    const c = this.canvas.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: (r.left + (r.width / 2)) - c.left, y: (r.top + (r.height / 2)) - c.top };
  }

  get palette() {
    return PALETTES[this.theme] ?? PALETTES.forge;
  }

  /**
   * @param {object} p
   */
  spawn(p) {
    this.particles.push({ age: 0, drag: 0.98, gravity: 0, grow: 0, alpha: 1, ...p });
  }

  /**
   * An explosion of light from a point.
   * @param {number} x
   * @param {number} y
   * @param {object} [options]
   * @param {number} [options.count=60]
   * @param {number} [options.speed=260]   pixels per second at launch
   * @param {"sparks"|"burst"|"smoke"|"spiral"} [options.kind="burst"]
   */
  burst(x, y, { count = 60, speed = 260, kind = "burst" } = {}) {
    const pal = this.palette;
    for ( let i = 0; i < count; i++ ) {
      const a = rand(0, Math.PI * 2);
      const v = rand(0.25, 1) * speed;
      if ( kind === "sparks" ) {
        this.spawn({ x, y, vx: Math.cos(a) * v, vy: (Math.sin(a) * v) - rand(60, 200), gravity: 520,
          size: rand(3, 7), life: rand(0.5, 1.1), color: pick(pal.spark), streak: true, drag: 0.985 });
      }
      else if ( kind === "smoke" ) {
        this.spawn({ x: x + rand(-30, 30), y: y + rand(-20, 20), vx: rand(-20, 20), vy: rand(-70, -25),
          size: rand(18, 34), grow: 30, life: rand(1, 1.8), color: pick(pal.smoke), alpha: 0.55, additive: false });
      }
      else if ( kind === "spiral" ) {
        const r = rand(20, 120);
        this.spawn({ x: x + (Math.cos(a) * r), y: y + (Math.sin(a) * r), orbit: { cx: x, cy: y, r, a, w: rand(2, 4) },
          size: rand(3, 8), life: rand(0.6, 1.2), color: pick(pal.trail) });
      }
      else {
        this.spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: rand(4, 12), life: rand(0.6, 1.4),
          color: pick(pal.burst), drag: 0.96 });
      }
    }
  }

  /**
   * A few particles left behind by something moving.
   * @param {number} x
   * @param {number} y
   */
  trail(x, y) {
    const pal = this.palette;
    for ( let i = 0; i < 3; i++ ) {
      this.spawn({ x: x + rand(-6, 6), y: y + rand(-6, 6), vx: rand(-30, 30), vy: rand(-30, 30),
        size: rand(4, 10), life: rand(0.3, 0.7), color: pick(pal.trail) });
    }
  }

  /** Ambient particles: embers rising from the forge, or motes drifting around the circle. */
  #ambient(dt) {
    const rate = 14 * this.ambientRate;
    const n = Math.random() < ((rate * dt) % 1) ? Math.ceil(rate * dt) : Math.floor(rate * dt);
    const pal = this.palette;
    for ( let i = 0; i < n; i++ ) {
      if ( this.theme === "arcane" ) {
        this.spawn({ x: rand(0, this.width), y: rand(0, this.height), vx: rand(-8, 8), vy: rand(-18, -4),
          size: rand(2, 5), life: rand(2, 4), color: pick(pal.ember), twinkle: rand(3, 7), alpha: 0.8 });
      }
      else {
        this.spawn({ x: rand(this.width * 0.1, this.width * 0.9), y: this.height + 4, vx: rand(-12, 12),
          vy: rand(-80, -35), size: rand(2, 5), life: rand(2.2, 4), color: pick(pal.ember),
          wobble: rand(1, 3), twinkle: rand(6, 12), drag: 1, alpha: 0.9 });
      }
    }
  }

  #tick(now) {
    this.frame = requestAnimationFrame(this.#loop);
    if ( !this.canvas?.isConnected ) return;
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    if ( (this.canvas.clientWidth !== Math.round(this.width)) || (this.canvas.clientHeight !== Math.round(this.height)) ) {
      this.resize();
    }
    this.#ambient(dt);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    const alive = [];
    for ( const p of this.particles ) {
      p.age += dt;
      if ( p.age >= p.life ) continue;
      alive.push(p);
      if ( p.orbit ) {
        // Spiral inward while turning: motes drawn into the circle.
        p.orbit.a += p.orbit.w * dt;
        p.orbit.r *= (1 - (1.6 * dt));
        p.x = p.orbit.cx + (Math.cos(p.orbit.a) * p.orbit.r);
        p.y = p.orbit.cy + (Math.sin(p.orbit.a) * p.orbit.r);
      }
      else {
        p.vy += p.gravity * dt;
        p.vx *= p.drag;
        p.vy *= p.drag;
        if ( p.wobble ) p.vx += Math.sin((p.age * p.wobble * 3) + p.x) * 20 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      p.size += p.grow * dt;
      const t = p.age / p.life;
      let alpha = p.alpha * (t < 0.15 ? t / 0.15 : 1 - ((t - 0.15) / 0.85));
      if ( p.twinkle ) alpha *= 0.6 + (0.4 * Math.sin(p.age * p.twinkle));
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.globalCompositeOperation = p.additive === false ? "source-over" : "lighter";
      const img = sprite(p.color);
      if ( p.streak ) {
        // Sparks stretch along their velocity, which reads as speed.
        const len = Math.min(26, Math.hypot(p.vx, p.vy) * 0.04);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.drawImage(img, -len - p.size, -p.size / 2, (len * 2) + (p.size * 2), p.size);
        ctx.restore();
      }
      else ctx.drawImage(img, p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
    }
    this.particles = alive;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

/**
 * Promise wrapper for a Web Animations API animation.
 * @param {HTMLElement} el
 * @param {Keyframe[]} keyframes
 * @param {KeyframeAnimationOptions} options
 * @returns {Promise<void>}
 */
export function animate(el, keyframes, options) {
  return el.animate(keyframes, { fill: "forwards", ...options }).finished.then(() => {}, () => {});
}

/** @param {number} ms */
export const wait = ms => new Promise(r => setTimeout(r, ms));

/**
 * Glyph paths for the arcane circle, made from a seeded generator so every circle looks the same
 * without shipping a runic font.
 * @param {number} count
 * @returns {string[]}  SVG path data, each glyph in a 10x14 box
 */
export function runeGlyphs(count) {
  let seed = 7;
  const next = () => (seed = ((seed * 9301) + 49297) % 233280) / 233280;
  const glyphs = [];
  for ( let i = 0; i < count; i++ ) {
    const x = () => Math.round(next() * 10);
    const y = () => Math.round(next() * 14);
    let d = `M${5} 0 L5 14 `;
    const strokes = 1 + Math.floor(next() * 3);
    for ( let s = 0; s < strokes; s++ ) d += `M${x()} ${y()} L${x()} ${y()} `;
    glyphs.push(d.trim());
  }
  return glyphs;
}
