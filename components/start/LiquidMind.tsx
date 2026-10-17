"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import "./liquid.css";

/**
 * The thinking blob: a body of gold liquid glass on the marble, drawn by one WebGL shader.
 *
 * Every shape (the blob, each answer's pill, the drops) is a signed distance field; the shader joins them with a
 * smooth minimum, so shapes that come close grow a neck and merge like liquid, then lights the result like glass
 * (white shine top-left, amber edge bottom-right, a bright rim, a soft shadow) with a gold swirl inside.
 *
 * An answer is ONE object from start to finish: a pill condenses with its words on it, rounds into a bead of the
 * same area, flows into the blob, and the blob grows by exactly the bead's volume. When the plans arrive the blob
 * buds into one drop per plan, each a ∛n-th of its radius, so together the drops hold the blob's volume.
 */

export type DropInfo = { title: string; score: number } | null;

export type LiquidHandle = {
  /** An answer flows into the blob. */
  absorb: (label: string, opts?: { mono?: boolean }) => void;
  /** The model is running: faster swirl, pulse, waves. */
  think: (on: boolean) => void;
  /** Buds into one drop per entry; captions show when the entries have titles. */
  split: (drops: DropInfo[]) => Promise<void>;
  /** The drops flow back into one blob. */
  reform: () => Promise<void>;
  /** Sets the size as if this many answers had been taken in, without animation (restoring a session). */
  fill: (answers: number) => void;
  /** Eases back to the starting size. */
  reset: () => void;
  setHidden: (hidden: boolean) => void;
};

type Props = {
  className?: string;
  /** Where answers appear: along the right edge (beside a panel) or along the bottom (phones). */
  spawn?: "right" | "bottom";
  /** The blob's centre as fractions of the box. */
  center?: [number, number];
  /** The drop that's chosen (ringed). */
  picked?: number | null;
  onPick?: (i: number) => void;
  /** Loops a sample sequence (the landing hero). */
  demo?: boolean;
  ref?: Ref<LiquidHandle>;
};

type Geo = { w: number; h: number; cx: number; cy: number; R0: number };
type DropView = { dx: number; dy: number; r: number; info: DropInfo };

// ─── Timing ─────────────────────────────────────────────────

/** CSS-style cubic-bezier easing. */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dsx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const err = sx(t) - x;
      const d = dsx(t);
      if (Math.abs(err) < 1e-5 || Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return sy(Math.min(1, Math.max(0, t)));
  };
}
const EASE = bezier(0.45, 0, 0.25, 1);
const EASE_SPLIT = bezier(0.55, 0, 0.25, 1);
const linear = (t: number) => t;

/** A value moving through [offset, value] keys over `dur` ms from `start`, eased per segment like CSS keyframes. */
type Track = { start: number; dur: number; keys: [number, number][]; ease: (t: number) => number };
type Value = number | Track;

function sample(v: Value, now: number): number {
  if (typeof v === "number") return v;
  const t = v.dur > 0 ? Math.min(1, Math.max(0, (now - v.start) / v.dur)) : 1;
  const k = v.keys;
  if (t <= k[0][0]) return k[0][1];
  for (let i = 0; i < k.length - 1; i++) {
    const [o0, a] = k[i];
    const [o1, b] = k[i + 1];
    if (t <= o1) return a + (b - a) * v.ease(o1 > o0 ? (t - o0) / (o1 - o0) : 1);
  }
  return k[k.length - 1][1];
}
const track = (start: number, dur: number, keys: [number, number][], ease = EASE): Track => ({ start, dur, keys, ease });

type Shape = {
  kind: "bead" | "drop";
  x: Value; y: Value; hw: Value; hh: Value; rad: Value; op: Value; hl: Value; core: Value;
  phase: number;
  until: number; // remove after (ms timestamp), Infinity = keep
};

const MAXS = 12;
const MAX_RATIO = 1.4; // the blob stops growing visibly past this
const DEMO_ANSWERS = ["Independent house", "3 BHK", "30 × 50 ft", "Road east · Vastu"];
const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ─── Shader ─────────────────────────────────────────────────

const VERT = `attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
#define MAXS ${MAXS}
#define PI 3.14159265
uniform vec2 uRes;
uniform float uDpr;
uniform float uTime;
uniform float uThink;
uniform int uCount;
uniform vec4 uA[MAXS]; // x, y, half width, half height (CSS px). Shape 0 is the blob: x, y, radius.
uniform vec4 uB[MAXS]; // corner radius, presence, highlight, swirl
uniform vec4 uC[MAXS]; // kind (0 blob, 1 other), swirl phase

float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float wrapA(float a) { return mod(a + PI, 2.0 * PI) - PI; }
// A soft bump around angle c (Gaussian; squared by hand, since pow() is undefined for negative bases)
float band(float a, float c, float w) { float x = wrapA(a - c) / w; return exp(-x * x); }

float shapeD(vec4 a, vec4 b, vec4 c, vec2 p) {
  vec2 q = p - a.xy;
  float d;
  if (c.x < 0.5) {
    // The blob: a circle whose outline slowly churns, so it reads as liquid turning in place
    float th = atan(q.y, q.x);
    float w = 1.0 + 0.035 * sin(3.0 * th + 0.7 * uTime) + 0.025 * sin(2.0 * th - 1.1 * uTime + 1.0) + 0.018 * sin(5.0 * th + 1.6 * uTime);
    d = length(q) - a.z * w;
  } else {
    d = sdBox(q, a.zw, b.x);
  }
  // Presence below 1 shrinks the shape into nothing, the way liquid condenses or evaporates
  return d + (1.0 - b.y) * max(a.w, 8.0) * 1.3;
}

float field(vec2 p) {
  float d = 1e5;
  for (int i = 0; i < MAXS; i++) {
    if (i >= uCount) break;
    vec4 a = uA[i]; vec4 b = uB[i];
    if (b.y < 0.002 || a.z < 0.5) continue;
    d = smin(d, shapeD(a, b, uC[i], p), 26.0);
  }
  return d;
}

vec4 over(vec4 dst, vec3 c, float a) { return vec4(c * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a)); }

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float D = field(p);
  // Far from any liquid there's nothing to draw, shadow included
  if (D > 52.0) { gl_FragColor = vec4(0.0); return; }
  float Ds = field(p - vec2(0.0, 22.0));
  vec4 o = vec4(0.0);
  // Soft shadow on the marble
  o = over(o, vec3(0.114, 0.125, 0.145), 0.18 * (1.0 - smoothstep(-10.0, 32.0, Ds)));
  float m = 1.0 - smoothstep(-0.7, 0.7, D);
  if (m > 0.0) {
    vec2 n = normalize(vec2(field(p + vec2(1.0, 0.0)) - D, field(p + vec2(0.0, 1.0)) - D) + 1e-5);
    vec2 L = normalize(vec2(0.64, 0.77));
    float e = smoothstep(-16.0, -1.0, D);
    o = over(o, vec3(0.886, 0.769, 0.494), 0.86 * m);                                       // gold glass body
    o = over(o, vec3(0.561, 0.416, 0.133), 0.6 * m * e * pow(max(dot(n, L), 0.0), 1.5));     // amber edge, bottom-right
    o = over(o, vec3(1.0), 0.8 * m * e * pow(max(dot(n, -L), 0.0), 1.5));                   // shine, top-left
    for (int i = 0; i < MAXS; i++) {
      if (i >= uCount) break;
      vec4 a = uA[i]; vec4 b = uB[i]; vec4 c = uC[i];
      if (b.y < 0.002) continue;
      float R = c.x < 0.5 ? a.z : min(a.z, a.w);
      if (R < 1.0) continue;
      vec2 q = (p - a.xy) / R;
      float rr = length(q);
      if (b.w > 0.002 && rr < 1.1) {
        // The thinking swirl: cream and amber bands turning inside the glass, faster while the model runs
        float th = atan(q.y, q.x);
        float s1 = th - uTime * (c.x < 0.5 ? 1.57 : 1.2) + c.y;
        // A soft ring: fades out toward the edge and at the very centre, where the bands would pinch to a point
        float fall = (1.0 - smoothstep(0.18, 0.82, rr)) * smoothstep(0.0, 0.32, rr);
        float cream = 0.8 * band(s1, 1.66, 0.75) * fall;
        float amber = 0.5 * band(s1, 4.89, 0.8) * fall;
        if (c.x < 0.5) {
          float s2 = th + uTime * 7.0;
          float fall2 = (1.0 - smoothstep(0.3, 0.9, rr)) * smoothstep(0.0, 0.3, rr) * uThink;
          cream = cream * (1.0 - 0.5 * uThink) + 0.9 * band(s2, 1.2, 0.6) * fall2;
          amber = amber * (1.0 - 0.5 * uThink) + 0.65 * band(s2, 4.4, 0.7) * fall2;
        }
        o = over(o, vec3(1.0, 0.973, 0.886), cream * b.w * m);
        o = over(o, vec3(0.561, 0.416, 0.133), amber * b.w * m);
      }
      if (b.z > 0.002) {
        // Window highlights
        vec2 h = q - vec2(-0.34, -0.6);
        float cs = cos(0.42); float sn = sin(0.42);
        vec2 hr = vec2(cs * h.x + sn * h.y, -sn * h.x + cs * h.y);
        float e1 = 1.0 - smoothstep(0.45, 1.0, length(hr / vec2(0.3, 0.14)));
        o = over(o, vec3(1.0), 0.85 * e1 * b.z * m);
        if (c.x < 0.5) {
          vec2 h2 = q - vec2(0.52, 0.66);
          vec2 hr2 = vec2(cs * h2.x + sn * h2.y, -sn * h2.x + cs * h2.y);
          float e2 = 1.0 - smoothstep(0.4, 1.0, length(hr2 / vec2(0.12, 0.055)));
          o = over(o, vec3(1.0), 0.6 * e2 * b.z * m);
        }
      }
    }
    o = over(o, vec3(1.0, 0.973, 0.902), 0.95 * m * smoothstep(-2.6, -0.9, D));     // bright rim, a thin line at the edge
  }
  gl_FragColor = o;
}
`;

type GL = {
  gl: WebGLRenderingContext;
  u: Record<"res" | "dpr" | "time" | "think" | "count" | "A" | "B" | "C", WebGLUniformLocation | null>;
};

function initGL(canvas: HTMLCanvasElement): GL | null {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error("[LiquidMind] shader:", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (n: string) => gl.getUniformLocation(prog, n);
  return {
    gl,
    u: { res: U("uRes"), dpr: U("uDpr"), time: U("uTime"), think: U("uThink"), count: U("uCount"), A: U("uA"), B: U("uB"), C: U("uC") },
  };
}

// ─── Component ──────────────────────────────────────────────

export function LiquidMind({ className = "", spawn = "right", center = [0.5, 0.5], picked = null, onPick, demo = false, ref }: Props) {
  const [cxf, cyf] = center;
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geo>({ w: 0, h: 0, cx: 0, cy: 0, R0: 90 });
  const geoRef = useRef(geo);
  const [drops, setDrops] = useState<DropView[]>([]);

  const shapes = useRef<Shape[]>([]);
  const dropShapes = useRef<Shape[]>([]);
  const blob = useRef<Value>(1); // blob radius / base radius, as shown
  const ratio = useRef(1); // the same, including answers still in flight
  const thinkTarget = useRef(0);
  const thinkVal = useRef(0);
  const nextSpawn = useRef(0);
  const slot = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const glRef = useRef<GL | null>(null);
  const running = useRef({ visible: true, hidden: false });

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  // Geometry follows the box.
  useEffect(() => {
    const root = rootRef.current!;
    const measure = () => {
      const w = root.clientWidth;
      const h = root.clientHeight;
      const R0 = Math.max(48, Math.min(100, Math.min(w, h) * 0.15));
      const g = { w, h, cx: w * cxf, cy: h * cyf, R0 };
      geoRef.current = g;
      setGeo(g);
      const c = canvasRef.current;
      if (c) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        c.width = Math.max(1, Math.round(w * dpr));
        c.height = Math.max(1, Math.round(h * dpr));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [cxf, cyf]);

  // The render loop: samples every shape and draws one frame. Stops while off screen or hidden.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = initGL(canvas);
    glRef.current = ctx;
    if (!ctx) return;
    const { gl, u } = ctx;
    const A = new Float32Array(MAXS * 4);
    const B = new Float32Array(MAXS * 4);
    const C = new Float32Array(MAXS * 4);
    const reduced = prefersReducedMotion();
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!running.current.visible || running.current.hidden) return;
      const g = geoRef.current;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      thinkVal.current += (thinkTarget.current - thinkVal.current) * Math.min(1, dt * 3);
      const t = reduced ? 0 : now / 1000;
      // Shape 0 is the blob.
      const pulse = 1 + thinkVal.current * 0.028 * Math.sin(t * 3.5);
      const R = g.R0 * sample(blob.current, now) * pulse;
      A.set([g.cx, g.cy, R, R], 0);
      B.set([R, R > 0.5 ? 1 : 0, 1, 1], 0);
      C.set([0, 0, 0, 0], 0);
      shapes.current = shapes.current.filter((s) => s.until > now);
      let n = 1;
      for (const s of [...dropShapes.current, ...shapes.current]) {
        if (n >= MAXS) break;
        const hw = sample(s.hw, now);
        const hh = sample(s.hh, now);
        A.set([g.cx + sample(s.x, now), g.cy + sample(s.y, now), hw, hh], n * 4);
        B.set([Math.min(sample(s.rad, now), hw, hh), sample(s.op, now), sample(s.hl, now), sample(s.core, now)], n * 4);
        C.set([1, s.phase, 0, 0], n * 4);
        n++;
      }
      const dpr = canvas.width / Math.max(1, g.w);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.dpr, dpr);
      gl.uniform1f(u.time, t);
      gl.uniform1f(u.think, thinkVal.current);
      gl.uniform1i(u.count, n);
      gl.uniform4fv(u.A, A);
      gl.uniform4fv(u.B, B);
      gl.uniform4fv(u.C, C);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    raf = requestAnimationFrame(frame);
    const root = rootRef.current!;
    const io = new IntersectionObserver(([e]) => {
      running.current.visible = e.isIntersecting;
      root.classList.toggle("is-offscreen", !e.isIntersecting);
    });
    io.observe(root);
    // The context stays with the canvas: releasing it here would break React's development double-mount.
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  /** Moves the blob's size through [offset, value] keys; a NaN first value means "from where it is now". */
  const scaleBlob = useCallback((keys: [number, number][], dur: number, ease = EASE) => {
    const now = performance.now();
    const from = sample(blob.current, now);
    blob.current = track(now, dur, keys.map(([o, v], i) => [o, i === 0 && Number.isNaN(v) ? from : v] as [number, number]), ease);
  }, []);

  const absorb = useCallback(
    (label: string, opts: { mono?: boolean } = {}) => {
      const g = geoRef.current;
      const labels = labelsRef.current;
      if (!labels || !g.w) return;
      const reduced = prefersReducedMotion();
      // Answers given in quick succession wait their turn.
      const now0 = performance.now();
      const delay = Math.max(0, nextSpawn.current - now0);
      nextSpawn.current = now0 + delay + 700;

      later(() => {
        // The words, measured first so the pill fits them.
        const text = document.createElement("span");
        text.className = `lm-label${opts.mono ? " is-mono" : ""}`;
        text.textContent = label;
        labels.appendChild(text);
        const tw = text.offsetWidth;
        const ph = g.R0 < 70 ? 42 : 48;
        const pw = Math.max(ph + 16, tw + 36);
        // A pill and a circle of the same area; the bead then adds its volume to the blob.
        const area = pw * ph - (ph * ph - (Math.PI * ph * ph) / 4);
        const r = Math.sqrt(area / Math.PI);
        const before = ratio.current;
        const after = Math.min(MAX_RATIO, Math.cbrt(before ** 3 + (r / g.R0) ** 3));
        ratio.current = after;

        // Where it appears: beside the panel, or along the bottom on phones.
        const k = slot.current++ % 4;
        const sx = spawn === "right" ? g.w - 24 - pw / 2 : g.cx + [-0.24, 0.12, -0.06, 0.22][k] * g.w;
        const sy = spawn === "right" ? g.cy + [-0.2, -0.07, 0.07, 0.2][k] * g.h : g.h - 100; // clear of the log line on phones
        text.style.left = `${sx}px`;
        text.style.top = `${sy}px`;
        const ox = sx - g.cx;
        const oy = sy - g.cy;
        const len = Math.hypot(ox, oy) || 1;
        const ux = ox / len;
        const uy = oy / len;
        const contact = g.R0 * before + r - 8;

        if (reduced) {
          text.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 1600, fill: "forwards" }).onfinish = () => text.remove();
          blob.current = after;
          return;
        }

        // Timing (ms): condense 0–420, words readable to 1250, round to 1800, flow to 2750, drain in by 3100.
        const T = 3100;
        const now = performance.now();
        const o = (ms: number) => ms / T;
        const keysAt = (vals: number[]): [number, number][] => [0, 420, 1250, 1800, 2750, 3100].map((ms, i) => [o(ms), vals[i]]);
        const ex = ux * g.R0 * before * 0.3;
        const ey = uy * g.R0 * before * 0.3;
        shapes.current.push({
          kind: "bead",
          x: track(now, T, keysAt([ox + 20, ox, ox, ox, ux * contact, ex])),
          y: track(now, T, keysAt([oy, oy, oy, oy, uy * contact, ey])),
          hw: track(now, T, keysAt([pw / 2, pw / 2, pw / 2, r, r, 0])),
          hh: track(now, T, keysAt([ph / 2, ph / 2, ph / 2, r, r, 0])),
          rad: track(now, T, keysAt([ph / 2, ph / 2, ph / 2, r, r, 0])),
          op: track(now, T, [[0, 0], [o(420), 1], [1, 1]]),
          hl: track(now, T, [[0, 0], [o(1450), 0], [o(1800), 1], [o(2650), 1], [o(3000), 0], [1, 0]], linear),
          core: 0,
          phase: Math.random() * 6,
          until: now + T + 30,
        });
        // The words show once the pill is under them, and are gone before it's half round.
        text.animate(
          [
            { opacity: 0, transform: "translateX(8px)" },
            { opacity: 0, offset: o(260), transform: "translateX(8px)" },
            { opacity: 1, offset: o(520), transform: "none" },
            { opacity: 1, offset: o(1250), transform: "none" },
            { opacity: 0, offset: o(1530), transform: "scale(0.94)" },
            { opacity: 0, transform: "scale(0.94)" },
          ],
          { duration: T, fill: "forwards" }
        );
        // The blob takes the volume as the bead drains in.
        later(() => scaleBlob([[0, NaN], [1, after]], 380), 2740);
        later(() => text.remove(), T + 60);
      }, delay);
    },
    [later, scaleBlob, spawn]
  );

  const think = useCallback((on: boolean) => {
    thinkTarget.current = on ? 1 : 0;
    rootRef.current?.classList.toggle("is-thinking", on);
    if (on) rootRef.current?.classList.add("is-veined");
  }, []);

  const split = useCallback(
    (infos: DropInfo[]) =>
      new Promise<void>((done) => {
        const g = geoRef.current;
        const n = Math.min(infos.length, 6);
        if (!n) return done();
        const R = g.R0 * ratio.current;
        const r = R / Math.cbrt(n);
        // A ring of drops around the centre, far enough apart not to touch, inside the box.
        const start = n % 2 === 0 ? -Math.PI / 2 + Math.PI / n : -Math.PI / 2;
        const ring = (r + 26) / Math.sin(Math.PI / Math.max(n, 2));
        const caption = infos.some(Boolean) ? 54 : 16;
        const rx = Math.max(ring, Math.min(g.w * 0.3, g.cx - r - 16, g.w - g.cx - r - 16));
        const ry = Math.max(ring * 0.78, Math.min(g.h * 0.28, g.cy - r - 24, g.h - g.cy - r - caption));
        const list: DropView[] = infos.slice(0, n).map((info, i) => {
          const a = start + (i * 2 * Math.PI) / n;
          return { dx: Math.cos(a) * rx, dy: Math.sin(a) * ry, r, info };
        });
        const reduced = prefersReducedMotion();
        const D = reduced ? 1 : 1200;
        const now = performance.now();
        dropShapes.current = list.map((p, i) => ({
          kind: "drop" as const,
          x: track(now, D, [[0, 0], [1, p.dx]], EASE_SPLIT),
          y: track(now, D, [[0, 0], [1, p.dy]], EASE_SPLIT),
          hw: r, hh: r, rad: r, op: 1,
          // Highlights only once each drop is free of the others.
          hl: track(now, D, [[0, 0], [0.55, 0], [0.95, 1], [1, 1]], linear),
          core: track(now, D, [[0, 0], [0.55, 0], [0.95, 1], [1, 1]], linear),
          phase: i * 1.7,
          until: Infinity,
        }));
        // Budding: the blob holds while the drops push out, then thins away as the necks snap.
        rootRef.current?.classList.add("is-split");
        const s = ratio.current;
        if (reduced) blob.current = 0;
        else scaleBlob([[0, s], [0.37, s * 0.93], [0.58, s * 0.36], [0.71, 0], [1, 0]], D);
        later(() => {
          setDrops(list);
          done();
        }, D + 40);
      }),
    [later, scaleBlob]
  );

  const reform = useCallback(
    () =>
      new Promise<void>((done) => {
        const els = dropShapes.current;
        setDrops([]);
        rootRef.current?.classList.remove("is-split", "is-veined");
        if (!els.length) return done();
        const reduced = prefersReducedMotion();
        const D = reduced ? 1 : 1000;
        const now = performance.now();
        for (const d of els) {
          const x = sample(d.x, now);
          const y = sample(d.y, now);
          d.x = track(now, D, [[0, x], [1, 0]], EASE_SPLIT);
          d.y = track(now, D, [[0, y], [1, 0]], EASE_SPLIT);
          d.hl = track(now, D, [[0, 1], [0.3, 0], [1, 0]], linear);
          d.core = track(now, D, [[0, 1], [0.3, 0], [1, 0]], linear);
        }
        const s = ratio.current;
        if (reduced) blob.current = s;
        else scaleBlob([[0, 0], [0.56, 0], [0.8, s * 0.93], [0.9, s], [1, s]], D);
        later(() => {
          dropShapes.current = [];
          done();
        }, D + 40);
      }),
    [later, scaleBlob]
  );

  const fill = useCallback((answers: number) => {
    ratio.current = Math.min(MAX_RATIO, Math.cbrt(1 + answers * 0.075));
    blob.current = ratio.current;
  }, []);

  const reset = useCallback(() => {
    ratio.current = 1;
    scaleBlob([[0, NaN], [1, 1]], 1200);
  }, [scaleBlob]);

  const setHidden = useCallback((hidden: boolean) => {
    running.current.hidden = hidden;
    rootRef.current?.classList.toggle("is-hidden", hidden);
  }, []);

  useImperativeHandle(ref, () => ({ absorb, think, split, reform, fill, reset, setHidden }), [absorb, think, split, reform, fill, reset, setHidden]);

  // The landing hero: a sample house taken in, thought over, split, and back again, on a loop.
  useEffect(() => {
    if (!demo) return;
    let alive = true;
    const wait = (ms: number) => new Promise<void>((ok) => later(ok, ms));
    if (prefersReducedMotion()) {
      fill(4);
      return;
    }
    (async () => {
      await wait(700);
      while (alive) {
        for (const a of DEMO_ANSWERS) {
          if (!alive) return;
          absorb(a, { mono: /\d+ ×/.test(a) });
          await wait(1600);
        }
        await wait(1700);
        if (!alive) return;
        think(true);
        await wait(2600);
        think(false);
        await split([null, null, null, null]);
        await wait(2600);
        await reform();
        await wait(600);
        reset();
        await wait(1800);
      }
    })();
    return () => {
      alive = false;
    };
  }, [demo, absorb, think, split, reform, reset, fill, later]);

  // Seams of gold that run from the blob out to every edge while the model thinks
  const veinFilter = `lmv-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const veins = useMemo(() => {
    const { w, h, cx: x0, cy: y0 } = geo;
    if (!w) return [];
    return [-160, -112, -58, -14, 32, 96, 148].map((deg, i) => {
      const a = (deg * Math.PI) / 180;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      // Run to just past the box edge in this direction
      const len = Math.min(dx ? Math.abs((dx > 0 ? w - x0 : x0) / dx) : Infinity, dy ? Math.abs((dy > 0 ? h - y0 : y0) / dy) : Infinity) + 40;
      const px = -dy;
      const py = dx;
      const bend = (i % 2 ? 1 : -1) * len * 0.09;
      const at = (t: number, off: number) => `${(x0 + dx * len * t + px * off).toFixed(1)} ${(y0 + dy * len * t + py * off).toFixed(1)}`;
      return { d: `M${at(0, 0)} C${at(0.3, bend)} ${at(0.45, -bend)} ${at(0.6, bend * 0.4)} S${at(0.9, -bend * 0.6)} ${at(1, 0)}`, wide: i % 3 === 0, delay: i * 90 };
    });
  }, [geo]);

  const { cx, cy, R0 } = geo;
  return (
    <div ref={rootRef} className={`lm ${className}`.trim()}>
      <svg className="lm-veins" aria-hidden="true">
        <defs>
          <filter id={veinFilter} x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="2" seed="3" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="9" />
          </filter>
        </defs>
        <g filter={`url(#${veinFilter})`} fill="none" strokeLinecap="round">
          {veins.map((v, i) => (
            <path key={i} d={v.d} pathLength={1} stroke={i % 2 ? "#d6ae5b" : "#c49a45"} strokeWidth={v.wide ? 2.2 : 1.4} style={{ transitionDelay: `${v.delay}ms` }} />
          ))}
        </g>
      </svg>
      {/* Light and waves on the marble, under the glass */}
      <div className="lm-ground" style={{ left: cx, top: cy }} aria-hidden="true">
        <span className="lm-caustic" style={{ width: R0 * 2.6, height: R0 * 0.4, top: R0 * 1.55 }} />
        <span className="lm-wave" style={{ width: R0 * 2.2, height: R0 * 2.2 }} />
        <span className="lm-wave lm-wave2" style={{ width: R0 * 2.2, height: R0 * 2.2 }} />
        <span className="lm-wave lm-wave3" style={{ width: R0 * 2.2, height: R0 * 2.2 }} />
      </div>

      <canvas ref={canvasRef} className="lm-canvas" aria-hidden="true" />
      <div className="lm-labels" ref={labelsRef} aria-hidden="true" />

      {/* Each drop is a plan: pick it to see it in 3D (the panel has the same choice for keyboards and screen readers) */}
      {drops.some((d) => d.info) && (
        <div className="lm-drops">
          {drops.map((d, i) =>
            d.info ? (
              <div key={i} className={`lm-drop${picked === i ? " is-picked" : ""}`} style={{ left: cx + d.dx, top: cy + d.dy, width: d.r * 2, height: d.r * 2 }}>
                <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => onPick?.(i)} />
                <span className="lm-drop-caption" style={{ top: d.r * 2 + 10 }}>
                  <span className="lm-drop-title">{d.info.title}</span>
                  <span className="lm-drop-score">{d.info.score}</span>
                </span>
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}
