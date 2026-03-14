import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, ReferenceLine, CartesianGrid,
  Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell,
} from "recharts";

// ═══════════════════════════════════════════════════════════════════════
// PDM Personal Edition — Reference Simulator
// Faithful reproduction of StepPDM from pdm-personal/main.go v1.0.1
//
// Design principle: S is the ONLY state variable. StepPDM is the ONLY
// function that mutates it. All accounting derives from S and traces.
// No treasury layer, no user balances, no inflow modes. Clean.
// ═══════════════════════════════════════════════════════════════════════

// ─── Seeded PRNG (Mulberry32) for reproducible telemetry ─────────────
function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── SHA-256 for audit chain ─────────────────────────────────────────
// Primary: Web Crypto API (requires secure context: HTTPS / localhost).
// Fallback: pure-JS implementation for file:// or plain HTTP contexts.
function sha256Fallback(msg) {
  // Minimal pure-JS SHA-256 (no dependencies)
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const bytes = new TextEncoder().encode(msg);
  const bits = bytes.length * 8;
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000), false);
  view.setUint32(padded.length - 4, bits >>> 0, false);
  let [h0,h1,h2,h3,h4,h5,h6,h7] = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  for (let off = 0; off < padded.length; off += 64) {
    const w = new Int32Array(64);
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15]>>>3);
      const s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2]>>>10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
    }
    let [a,b,c,d,e,f,g,h] = [h0,h1,h2,h3,h4,h5,h6,h7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    h0=(h0+a)|0; h1=(h1+b)|0; h2=(h2+c)|0; h3=(h3+d)|0;
    h4=(h4+e)|0; h5=(h5+f)|0; h6=(h6+g)|0; h7=(h7+h)|0;
  }
  return [h0,h1,h2,h3,h4,h5,h6,h7].map(v => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

async function sha256(msg) {
  const hasCryptoSubtle =
    typeof crypto !== "undefined" &&
    crypto.subtle &&
    typeof crypto.subtle.digest === "function";

  if (hasCryptoSubtle) {
    const buf = new TextEncoder().encode(msg);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  return sha256Fallback(msg);
}

// ─── PDM Configuration (matches Go DefaultConfig) ────────────────────
const DEFAULT_CONFIG = {
  phiTarget: 0.618,
  bandLow: 0.60,
  bandHigh: 0.62,
  burnBase: 0.000618,
  burnVelocityK: 0.1,
};

function validateConfig(cfg, mcap) {
  if (cfg.phiTarget <= 0 || cfg.phiTarget >= 1) return "φ must be in (0,1)";
  if (cfg.bandLow <= 0 || cfg.bandHigh <= 0) return "bands must be > 0";
  if (cfg.bandLow >= cfg.bandHigh) return "bL must be < bH";
  if (cfg.bandLow > cfg.phiTarget || cfg.phiTarget > cfg.bandHigh) return "bL ≤ φ ≤ bH required";
  if (cfg.burnBase < 0) return "B must be ≥ 0";
  if (cfg.burnVelocityK < 0) return "k must be ≥ 0";
  if (mcap <= 0) return "M must be > 0";
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// StepPDM — Reproduction of pdm-personal/main.go v1.0.1
//
// Input:  (sPrev, oi, vtotal, mcap, cfg)
// Output: { sNew, trace }
//
// Every line maps to the whitepaper Section 4 equations. The control
// law (burn, mint, damping, cap enforcement) is identical to Go.
//
// Hash chain: same SHA-256 algorithm as Go (Section 4.7), but the
// serialisation format differs (JS JSON.stringify vs Go json.Marshal),
// so hashes are deterministic within this runtime but NOT byte-identical
// to the Go reference. Cross-language hash verification would require
// a shared canonical encoding.
// ═══════════════════════════════════════════════════════════════════════
function stepPDM(sPrev, oi, vtotal, mcap, cfg) {
  const minS = 1e-9 * mcap;
  const minO = 1e-6;

  // §4.1 Safety guards
  const effectiveOi = Math.max(oi, minO);
  const sSafe = Math.max(sPrev, minS);

  // §4.2 Velocity and deviation
  const velocity = vtotal / sSafe;
  const deviation = velocity - cfg.phiTarget;

  // §4.3 Burn term
  let burnRate = 1.0 - cfg.burnVelocityK * deviation;
  if (burnRate < 0) burnRate = 0;
  const burnAmount = cfg.burnBase * burnRate * vtotal;
  let sTemp = sPrev - burnAmount;
  let clampedS = false;
  if (sTemp < 0) { clampedS = true; sTemp = 0; }

  // §4.4 Ratio and band evaluation
  const l = sTemp / effectiveOi;

  // §4.5 Progressive damping and mint
  let mintRaw = 0, delta = 0, lambda = 0;
  let band = "IN_BAND";
  lambda = Math.pow(cfg.phiTarget, sTemp / mcap);

  if (l < cfg.bandLow) {
    band = "BELOW";
    mintRaw = cfg.phiTarget * effectiveOi - sTemp;
    if (mintRaw < 0) mintRaw = 0;
    delta = mintRaw * lambda;
  } else if (l >= cfg.bandHigh) {
    band = "ABOVE";
    delta = 0;
  }
  // In-band: delta stays 0 (Go zero-value initialisation)

  // §4.6 Capacity enforcement
  let sNew = sTemp + delta;
  let clampedCap = false;
  if (sNew > mcap) {
    clampedCap = true;
    delta = mcap - sTemp;
    sNew = mcap;
  }

  return {
    sNew,
    trace: {
      sPrev, oi: effectiveOi, oiRaw: oi, vTotal: vtotal, mcap,
      velocity, deviation, burnRate, burnAmount, sTemp,
      l, band, lambda, mintRaw, delta, sNew,
      clampedS, clampedCap,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// TELEMETRY GENERATORS — Produce (O, V) sequences for simulation
// ═══════════════════════════════════════════════════════════════════════
const TELEMETRY_PROFILES = {
  equilibrium: {
    label: "Stable Equilibrium",
    desc: "O = 1,000,000 steady, V ≈ 50k–60k random. System should stay in-band with gentle burns.",
    generate: (step, mcap, rng) => ({
      O: 1_000_000,
      V: 50_000 + rng() * 10_000,
    }),
    defaultS0Pct: 61.8,
  },
  demandShock: {
    label: "Demand Shock",
    desc: "O = 2,000,000 (double capacity ratio target), V = 80,000. Heavy minting pressure, cap-limited recovery.",
    generate: (step, mcap, rng) => ({
      O: 2_000_000,
      V: 80_000,
    }),
    defaultS0Pct: 40,
  },
  oscillating: {
    label: "Oscillating Demand",
    desc: "O swings between 800k and 1.2M on a sine wave (period 40 steps). Tests band transitions.",
    generate: (step, mcap, rng) => ({
      O: 1_000_000 + 200_000 * Math.sin(step * 2 * Math.PI / 40),
      V: 50_000 + rng() * 15_000,
    }),
    defaultS0Pct: 61.8,
  },
  droughtThenShock: {
    label: "Drought → Shock",
    desc: "Steps 1–30: low O (100k), minimal V. Steps 31+: O jumps to 3M. Tests recovery from deep depletion.",
    generate: (step, mcap, rng) => {
      if (step <= 30) return { O: 100_000, V: 5_000 + rng() * 2_000 };
      return { O: 3_000_000, V: 100_000 };
    },
    defaultS0Pct: 61.8,
  },
  extremeBurn: {
    label: "Extreme Burn Pressure",
    desc: "O = 1M, V = 999,999,999. Tests non-negativity under adversarial throughput. (Whitepaper C.5)",
    generate: (step, mcap, rng) => ({
      O: 1_000_000,
      V: 999_999_999,
    }),
    defaultS0Pct: 0.01,
  },
  capSaturation: {
    label: "Cap Saturation",
    desc: "O = 50M (extreme demand), V = 100 (minimal burn). Tests cap enforcement. (Whitepaper C.4)",
    generate: (step, mcap, rng) => ({
      O: 50_000_000,
      V: 100,
    }),
    defaultS0Pct: 95,
  },
  custom: {
    label: "Custom (Manual)",
    desc: "Enter O and V manually each step or use fixed values.",
    generate: null,
    defaultS0Pct: 61.8,
  },
  regimeSequence: {
    label: "Regime Sequence",
    desc: "Programmable schedule of (O, V, duration) blocks. State carries through continuously. Supports stochastic bursts.",
    generate: null, // handled specially in tick
    defaultS0Pct: 61.8,
  },
};

// ═══════════════════════════════════════════════════════════════════════
// REGIME PRESETS — Pre-built regime sequences for stress testing
// Each regime is { label, O, V, steps, burstChance, burstScale }
// burstChance: probability per step of a V spike (0-1)
// burstScale: multiplier for V during a burst (e.g. 1.5 = 50% spike)
// ═══════════════════════════════════════════════════════════════════════
const REGIME_PRESETS = {
  multiRegimeStress: {
    label: "Multi-Regime Stress",
    desc: "5 economic regimes cycling every 100 steps with stochastic V bursts. Tests compound disturbance stability.",
    s0Pct: 60,
    regimes: [
      { label: "Stable Economy",      O: 500_000,   V: 50_000,  steps: 100, burstChance: 0.1, burstScale: 1.3 },
      { label: "Growth Boom",         O: 650_000,   V: 80_000,  steps: 100, burstChance: 0.15, burstScale: 1.4 },
      { label: "Speculative Surge",   O: 700_000,   V: 110_000, steps: 100, burstChance: 0.2, burstScale: 1.5 },
      { label: "Panic Liquidation",   O: 850_000,   V: 95_000,  steps: 100, burstChance: 0.25, burstScale: 1.6 },
      { label: "Liquidity Drought",   O: 450_000,   V: 30_000,  steps: 100, burstChance: 0.05, burstScale: 1.2 },
      { label: "Stable Economy",      O: 500_000,   V: 50_000,  steps: 100, burstChance: 0.1, burstScale: 1.3 },
      { label: "Growth Boom",         O: 650_000,   V: 80_000,  steps: 100, burstChance: 0.15, burstScale: 1.4 },
      { label: "Panic Liquidation",   O: 850_000,   V: 95_000,  steps: 100, burstChance: 0.25, burstScale: 1.6 },
      { label: "Liquidity Drought",   O: 450_000,   V: 30_000,  steps: 100, burstChance: 0.05, burstScale: 1.2 },
      { label: "Speculative Surge",   O: 700_000,   V: 110_000, steps: 100, burstChance: 0.2, burstScale: 1.5 },
    ],
  },
  blackSwan: {
    label: "Black Swan",
    desc: "Mass liquidation spike (O=950k, V=1.3M) followed by immediate post-crash vacuum (O=400k, V=25k).",
    s0Pct: 60,
    regimes: [
      { label: "Normal",              O: 500_000,   V: 50_000,  steps: 200, burstChance: 0.1, burstScale: 1.3 },
      { label: "Mass Liquidation",    O: 950_000,   V: 1_300_000, steps: 100, burstChance: 0.3, burstScale: 1.5 },
      { label: "Post-Crash Vacuum",   O: 400_000,   V: 25_000,  steps: 100, burstChance: 0.02, burstScale: 1.1 },
      { label: "Slow Recovery",       O: 550_000,   V: 40_000,  steps: 200, burstChance: 0.08, burstScale: 1.2 },
      { label: "Normal",              O: 500_000,   V: 50_000,  steps: 200, burstChance: 0.1, burstScale: 1.3 },
    ],
  },
  rapidDemandCollapse: {
    label: "Rapid Demand Collapse",
    desc: "High supply (80% M), demand drops to 300k. Tests slow contraction and burn dominance.",
    s0Pct: 80,
    regimes: [
      { label: "High Supply",         O: 300_000,   V: 25_000,  steps: 500, burstChance: 0.05, burstScale: 1.2 },
      { label: "Demand Returns",      O: 800_000,   V: 60_000,  steps: 300, burstChance: 0.1, burstScale: 1.3 },
      { label: "Collapse Again",      O: 200_000,   V: 15_000,  steps: 300, burstChance: 0.03, burstScale: 1.1 },
    ],
  },
  hyperVelocityShock: {
    label: "Hyper-Velocity Shock",
    desc: "Extreme V = 250k with moderate demand. Tests burn instability and oscillation.",
    s0Pct: 40,
    regimes: [
      { label: "Normal",              O: 700_000,   V: 50_000,  steps: 100, burstChance: 0.1, burstScale: 1.3 },
      { label: "Velocity Spike",      O: 700_000,   V: 250_000, steps: 200, burstChance: 0.3, burstScale: 2.0 },
      { label: "Cool Down",           O: 700_000,   V: 40_000,  steps: 200, burstChance: 0.05, burstScale: 1.1 },
      { label: "Second Spike",        O: 700_000,   V: 300_000, steps: 150, burstChance: 0.35, burstScale: 2.2 },
      { label: "Recovery",            O: 700_000,   V: 55_000,  steps: 200, burstChance: 0.08, burstScale: 1.2 },
    ],
  },
  capacitySpiral: {
    label: "Capacity Spiral",
    desc: "Demand grows continuously, exceeding M. Tests cap enforcement under sustained pressure.",
    s0Pct: 50,
    regimes: [
      { label: "Normal Demand",       O: 600_000,   V: 50_000,  steps: 150, burstChance: 0.1, burstScale: 1.2 },
      { label: "Rising Demand",       O: 900_000,   V: 65_000,  steps: 150, burstChance: 0.12, burstScale: 1.3 },
      { label: "Excessive Demand",    O: 1_200_000, V: 80_000,  steps: 200, burstChance: 0.15, burstScale: 1.4 },
      { label: "Beyond Capacity",     O: 2_000_000, V: 100_000, steps: 200, burstChance: 0.2, burstScale: 1.5 },
      { label: "Demand Eases",        O: 800_000,   V: 55_000,  steps: 200, burstChance: 0.08, burstScale: 1.2 },
    ],
  },
  liquidityWhiplash: {
    label: "Liquidity Whiplash",
    desc: "Rapid alternation between high and low activity. Exposes control-loop oscillation.",
    s0Pct: 60,
    regimes: [
      { label: "Normal",              O: 600_000,   V: 50_000,  steps: 80, burstChance: 0.1, burstScale: 1.3 },
      { label: "High Activity",       O: 600_000,   V: 300_000, steps: 80, burstChance: 0.3, burstScale: 1.8 },
      { label: "Low Activity",        O: 600_000,   V: 20_000,  steps: 80, burstChance: 0.03, burstScale: 1.1 },
      { label: "High Activity",       O: 600_000,   V: 280_000, steps: 80, burstChance: 0.3, burstScale: 1.8 },
      { label: "Low Activity",        O: 600_000,   V: 25_000,  steps: 80, burstChance: 0.03, burstScale: 1.1 },
      { label: "High Activity",       O: 600_000,   V: 350_000, steps: 80, burstChance: 0.35, burstScale: 2.0 },
      { label: "Recovery",            O: 600_000,   V: 55_000,  steps: 150, burstChance: 0.08, burstScale: 1.2 },
    ],
  },
  customRegime: {
    label: "Custom Regime",
    desc: "Build your own regime sequence. Add, remove, and reorder blocks.",
    s0Pct: 61.8,
    regimes: [
      { label: "Phase 1", O: 1_000_000, V: 50_000, steps: 200, burstChance: 0.1, burstScale: 1.3 },
      { label: "Phase 2", O: 1_500_000, V: 80_000, steps: 200, burstChance: 0.15, burstScale: 1.4 },
    ],
  },
};

// ═══════════════════════════════════════════════════════════════════════
// STYLING
// ═══════════════════════════════════════════════════════════════════════
const C = {
  bg: "#06090f",
  surface: "#0d1117",
  panel: "#151b27",
  border: "#1b2535",
  borderHi: "#2a3a52",
  text: "#c9d1d9",
  dim: "#8b949e",
  muted: "#484f58",
  gold: "#d4a843",
  goldDim: "#8a6d2b",
  phi: "#d4a843",
  red: "#f85149",
  green: "#3fb950",
  blue: "#58a6ff",
  purple: "#bc8cff",
  orange: "#d29922",
  cyan: "#39d2c0",
  grid: "#151b27",
};

const mono = "'IBM Plex Mono', 'JetBrains Mono', 'SF Mono', 'Consolas', monospace";
const sans = "'IBM Plex Sans', 'Helvetica Neue', sans-serif";

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════
export default function PDMSimulator() {
  // ─── System Parameters ──────────────────────────────────────────
  const [mcap, setMcap] = useState(1_000_000);
  const [config, setConfig] = useState({ ...DEFAULT_CONFIG });
  const [profile, setProfile] = useState("equilibrium");
  const [seed, setSeed] = useState(42);
  const [s0Pct, setS0Pct] = useState(61.8);
  const [customO, setCustomO] = useState(1_000_000);
  const [customV, setCustomV] = useState(50_000);

  // ─── Regime Sequence State ──────────────────────────────────────
  const [regimePreset, setRegimePreset] = useState("multiRegimeStress");
  const [regimeBlocks, setRegimeBlocks] = useState(REGIME_PRESETS.multiRegimeStress.regimes);
  const [currentRegimeIdx, setCurrentRegimeIdx] = useState(0);
  const [currentRegimeLabel, setCurrentRegimeLabel] = useState("");

  // ─── Runtime State ──────────────────────────────────────────────
  const [supply, setSupply] = useState(0);
  const [history, setHistory] = useState([]);
  const [hashChain, setHashChain] = useState([]);
  const [prevHash, setPrevHash] = useState("");
  const [stepNum, setStepNum] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [cadenceMs, setCadenceMs] = useState(500);
  const [speedX, setSpeedX] = useState(1);

  // ─── Cumulative Ledger (derived from traces — always correct) ──
  const [ledger, setLedger] = useState({ totalBurned: 0, totalMinted: 0, mintEvents: 0 });

  // ─── UI ─────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("dashboard");
  const [verifyResult, setVerifyResult] = useState(null);
  const [stabilityResult, setStabilityResult] = useState(null);
  const [stabilityComputing, setStabilityComputing] = useState(false);

  // ─── Refs (authoritative for async tick) ────────────────────────
  const supplyRef = useRef(0);
  const prevHashRef = useRef("");
  const stepNumRef = useRef(0);
  const historyRef = useRef([]);
  const hashChainRef = useRef([]);
  const ledgerRef = useRef({ totalBurned: 0, totalMinted: 0, mintEvents: 0 });
  const prngRef = useRef(mulberry32(42));
  const configRef = useRef(config);
  const mcapRef = useRef(mcap);
  const profileRef = useRef(profile);
  const customORef = useRef(customO);
  const customVRef = useRef(customV);
  const regimeBlocksRef = useRef(REGIME_PRESETS.multiRegimeStress.regimes);
  const isRunningRef = useRef(false);
  const cadenceRef = useRef(cadenceMs);
  const speedRef = useRef(speedX);
  const runIdRef = useRef(0);
  const tickBusy = useRef(false);

  // ─── Streaming export log (minimal per-step, grows for full run) ─
  // Each entry is ~120 bytes. At 100k steps ≈ 12MB — manageable.
  // Cleared on Reset. Exported via "Export Full Run".
  const streamLogRef = useRef([]);
  const [streamLogCount, setStreamLogCount] = useState(0);

  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { mcapRef.current = mcap; }, [mcap]);
  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => { customORef.current = customO; }, [customO]);
  useEffect(() => { customVRef.current = customV; }, [customV]);
  useEffect(() => { regimeBlocksRef.current = regimeBlocks; }, [regimeBlocks]);
  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);
  useEffect(() => { cadenceRef.current = cadenceMs; }, [cadenceMs]);
  useEffect(() => { speedRef.current = speedX; }, [speedX]);

  // ─── Initialize ─────────────────────────────────────────────────
  const initializeSystem = useCallback(() => {
    const s0 = mcap * (s0Pct / 100);
    runIdRef.current += 1;
    tickBusy.current = false;

    supplyRef.current = s0;
    prevHashRef.current = "";
    stepNumRef.current = 0;
    historyRef.current = [];
    hashChainRef.current = [];
    ledgerRef.current = { totalBurned: 0, totalMinted: 0, mintEvents: 0 };
    streamLogRef.current = [];
    prngRef.current = mulberry32(seed);

    setSupply(s0);
    setPrevHash("");
    setStepNum(0);
    setHistory([]);
    setHashChain([]);
    setLedger({ totalBurned: 0, totalMinted: 0, mintEvents: 0 });
    setStreamLogCount(0);
    setVerifyResult(null);
    setStabilityResult(null);
    setCurrentRegimeIdx(0);
    setCurrentRegimeLabel("");
    setInitialized(true);
  }, [mcap, s0Pct, seed]);

  useEffect(() => { if (!initialized) initializeSystem(); }, [initialized, initializeSystem]);

  // Auto-reinit when STRUCTURAL parameters change while stopped.
  // Only M, S₀%, and seed trigger a full reset. Controller tuning
  // (φ, bL, bH, B, k) can be changed mid-run without resetting state,
  // enabling multi-regime stress tests with parameter switching.
  const isRunningForReinit = useRef(false);
  useEffect(() => { isRunningForReinit.current = isRunning; }, [isRunning]);
  useEffect(() => {
    if (initialized && !isRunningForReinit.current) initializeSystem();
  }, [initialized, initializeSystem, mcap, s0Pct, seed]);

  // Sync s0Pct when profile changes
  useEffect(() => {
    if (profile === "regimeSequence") {
      const preset = REGIME_PRESETS[regimePreset];
      if (preset) {
        setS0Pct(preset.s0Pct || 61.8);
        setRegimeBlocks(preset.regimes);
        regimeBlocksRef.current = preset.regimes;
      }
    } else {
      const p = TELEMETRY_PROFILES[profile];
      if (p && p.defaultS0Pct !== undefined) setS0Pct(p.defaultS0Pct);
    }
  }, [profile, regimePreset]);

  // ─── Tick: Generate telemetry → Run StepPDM → Hash → Commit ────
  const tick = useCallback(async () => {
    if (tickBusy.current) return;
    tickBusy.current = true;
    const localRunId = runIdRef.current;

    try {
      const cfg = configRef.current;
      const M = mcapRef.current;
      const rng = prngRef.current;
      const currentS = supplyRef.current;
      const step = stepNumRef.current + 1;

      // Generate telemetry from profile
      const prof = TELEMETRY_PROFILES[profileRef.current];
      let O, V;
      let regimeLabel = "";
      if (profileRef.current === "regimeSequence") {
        // Regime sequence: walk through blocks based on cumulative step count
        const blocks = regimeBlocksRef.current;
        let cumulative = 0;
        let blockIdx = 0;
        for (let i = 0; i < blocks.length; i++) {
          if (step <= cumulative + blocks[i].steps) { blockIdx = i; break; }
          cumulative += blocks[i].steps;
          if (i === blocks.length - 1) blockIdx = i; // clamp to last block
        }
        const block = blocks[blockIdx];
        regimeLabel = block.label || ("Phase " + (blockIdx + 1));
        O = block.O;
        V = block.V;
        // Stochastic burst: random V spike within this regime
        if (block.burstChance > 0 && rng() < block.burstChance) {
          V = V * (block.burstScale || 1.5);
        }
        // Add small noise for realism (seeded)
        O = O * (0.95 + rng() * 0.10);
        V = V * (0.90 + rng() * 0.20);
      } else if (prof.generate) {
        const tv = prof.generate(step, M, rng);
        O = tv.O;
        V = tv.V;
      } else {
        O = customORef.current;
        V = customVRef.current;
      }

      // Run the pure StepPDM function
      const { sNew, trace } = stepPDM(currentS, O, V, M, cfg);

      // Build hash chain (Section 4.7)
      const traceForHash = { step, ...trace };
      const traceJSON = JSON.stringify(traceForHash);
      const currentPrev = prevHashRef.current;
      const newHash = await sha256(currentPrev + traceJSON);

      // Cancel check after await
      if (runIdRef.current !== localRunId) return;

      const traceRecord = { step, ...trace, _hashBody: traceJSON, prevHash: currentPrev, hash: newHash };
      const hashRecord = { step, hash: newHash, prevHash: currentPrev };

      // ── Atomic commit ──────────────────────────────────────────
      supplyRef.current = sNew;
      prevHashRef.current = newHash;
      stepNumRef.current = step;

      // Ledger: cumulative totals derived ONLY from trace values
      const prevLedger = ledgerRef.current;
      const newLedger = {
        totalBurned: prevLedger.totalBurned + trace.burnAmount,
        totalMinted: prevLedger.totalMinted + trace.delta,
        mintEvents: prevLedger.mintEvents + (trace.delta > 0 ? 1 : 0),
      };
      ledgerRef.current = newLedger;

      // Stream log: minimal record for full-run export (not windowed)
      // Field clarification:
      //   L       = sTemp / O   (band ratio — the variable the controller ACTUALLY regulates)
      //   lambda  = φ^(S/M)     (progressive damping factor)
      //   loadR   = S / M       (load ratio — normalised supply level)
      //   lyapV_L = (L − φ)²    (PRIMARY Lyapunov candidate — controller's own error metric)
      //   lyapV_SM = (S/M − φ)² (SECONDARY — only valid when O ≈ M)
      const loadR = sNew / M;
      const lyapV_L = Math.pow(trace.l - cfg.phiTarget, 2);
      const lyapV_SM = Math.pow(loadR - cfg.phiTarget, 2);
      streamLogRef.current.push({
        step, S: sNew, O: trace.oi, V: trace.vTotal,
        L: trace.l, burn: trace.burnAmount, delta: trace.delta,
        lambda: trace.lambda, band: trace.band, hash: newHash,
        loadR, lyapV_L, lyapV_SM,
        ...(regimeLabel ? { regime: regimeLabel } : {}),
      });

      // Regime indicator for UI
      if (regimeLabel) {
        setCurrentRegimeLabel(regimeLabel);
      }

      // History window (keep last 300)
      let nextHistory = [...historyRef.current, traceRecord];
      let nextChain = [...hashChainRef.current, hashRecord];
      if (nextHistory.length > 300) {
        nextHistory = nextHistory.slice(-300);
        nextChain = nextChain.slice(-300);
      }
      historyRef.current = nextHistory;
      hashChainRef.current = nextChain;

      // Sync state for render
      setSupply(sNew);
      setPrevHash(newHash);
      setStepNum(step);
      setHistory(nextHistory);
      setHashChain(nextChain);
      setLedger(newLedger);
      setStreamLogCount(streamLogRef.current.length);
    } finally {
      tickBusy.current = false;
    }
  }, []);

  // ─── Auto-run scheduler ─────────────────────────────────────────
  useEffect(() => {
    if (!isRunning) return;
    let timeoutId = null;
    let cancelled = false;
    const schedule = async () => {
      if (cancelled) return;
      const before = runIdRef.current;
      await tick();
      if (cancelled || !isRunningRef.current || runIdRef.current !== before) return;
      const delay = Math.max(30, cadenceRef.current / speedRef.current);
      timeoutId = setTimeout(schedule, delay);
    };
    timeoutId = setTimeout(schedule, Math.max(30, cadenceRef.current / speedRef.current));
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [isRunning, tick, speedX]);

  // ─── Hash chain verification ────────────────────────────────────
  const verifyChain = useCallback(async () => {
    const h = historyRef.current;
    if (h.length === 0) { setVerifyResult({ valid: false, msg: "No steps to verify." }); return; }
    let valid = true;
    let failMsg = "";
    let expectedPrev = ""; // genesis: first step chains from empty string
    for (let i = 0; i < h.length; i++) {
      if (h[i].prevHash !== expectedPrev) {
        valid = false; failMsg = `Step ${h[i].step}: prevHash chain break`; break;
      }
      const recomputed = await sha256(expectedPrev + h[i]._hashBody);
      if (recomputed !== h[i].hash) {
        valid = false; failMsg = `Step ${h[i].step}: hash mismatch`; break;
      }
      expectedPrev = h[i].hash;
    }
    setVerifyResult({
      valid,
      msg: valid
        ? `All ${h.length} steps verified. Chain intact.`
        : `FAILED: ${failMsg}`,
    });
  }, []);

  // ─── Derived values ─────────────────────────────────────────────
  const lastTrace = history.length > 0 ? history[history.length - 1] : null;
  const currentL = lastTrace ? lastTrace.l : null;
  const currentLambda = lastTrace ? lastTrace.lambda : Math.pow(config.phiTarget, supply / mcap);
  const bandStatus = currentL === null ? "—" : currentL < config.bandLow ? "BELOW" : currentL >= config.bandHigh ? "ABOVE" : "IN BAND";
  const configError = validateConfig(config, mcap);

  // ─── Accounting identity check ──────────────────────────────────
  // S_now = S_0 - totalBurned + totalMinted
  // This holds exactly because trace.delta is already cap-adjusted
  // (see §4.6: if sNew > M, delta = M - sTemp). Any drift is
  // floating-point rounding only.
  const s0 = mcap * (s0Pct / 100);
  const expectedS = s0 - ledger.totalBurned + ledger.totalMinted;
  const accountingDrift = Math.abs(supply - expectedS);
  const accountingOk = accountingDrift < 0.01;

  // ─── Export utilities ────────────────────────────────────────────
  // Strategy: try blob download first (works in standalone React).
  // If blocked (e.g. Claude sandbox), fall back to clipboard copy.
  // If clipboard also fails, show the data in an alert.
  const [exportStatus, setExportStatus] = useState(null);

  const deliverJSON = useCallback((jsonStr, filename) => {
    // Attempt 1: blob download
    try {
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus({ ok: true, msg: `Downloaded ${filename}` });
      return;
    } catch (e) {
      // blocked — try clipboard
    }

    // Attempt 2: clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(jsonStr).then(
        () => setExportStatus({ ok: true, msg: `Copied to clipboard (${(jsonStr.length / 1024).toFixed(0)}KB)` }),
        () => setExportStatus({ ok: false, msg: "Export blocked in this environment. Copy the data from the History tab manually." })
      );
      return;
    }

    setExportStatus({ ok: false, msg: "Export not available in this environment." });
  }, []);

  // Auto-clear export status after 4 seconds
  useEffect(() => {
    if (exportStatus) {
      const t = setTimeout(() => setExportStatus(null), 4000);
      return () => clearTimeout(t);
    }
  }, [exportStatus]);

  // ─── Export: windowed (last 300 steps, full trace) ──────────────
  const exportHistory = useCallback(() => {
    const data = [...historyRef.current].map(({ _hashBody, ...rest }) => rest);
    if (data.length === 0) return;
    const jsonStr = JSON.stringify({
      exportedAt: new Date().toISOString(),
      exportType: "window",
      config: configRef.current, mcap: mcapRef.current,
      s0: mcapRef.current * (s0Pct / 100), seed,
      totalSteps: data.length,
      ledger: { ...ledgerRef.current },
      steps: data,
    }, null, 2);
    deliverJSON(jsonStr, `pdm-window-${data.length}steps.json`);
  }, [s0Pct, seed, deliverJSON]);

  // ─── Export: full run (every step, minimal fields) ──────────────
  const exportFullRun = useCallback(() => {
    const log = [...streamLogRef.current];
    if (log.length === 0) return;
    const jsonStr = JSON.stringify({
      exportedAt: new Date().toISOString(),
      exportType: "full_run",
      config: configRef.current, mcap: mcapRef.current,
      s0: mcapRef.current * (s0Pct / 100), seed,
      totalSteps: log.length,
      ledger: { ...ledgerRef.current },
      fields: ["step", "S", "O", "V", "L", "burn", "delta", "lambda", "band", "hash", "loadR", "lyapV_L", "lyapV_SM"],
      steps: log,
    }, null, 2);
    deliverJSON(jsonStr, `pdm-fullrun-${log.length}steps.json`);
  }, [s0Pct, seed, deliverJSON]);

  // ═══════════════════════════════════════════════════════════════
  // STABILITY ANALYSIS — Lyapunov / Monte-Carlo / Restoring Force

  const computeStabilityAnalysis = useCallback(() => {
    const log = streamLogRef.current;
    if (log.length < 50) {
      setStabilityResult({ error: "Need at least 50 steps for analysis. Run the simulator longer." });
      return;
    }
    setStabilityComputing(true);

    // Use setTimeout to avoid blocking the UI
    setTimeout(() => {
      const M = mcapRef.current;
      const phi = configRef.current.phiTarget;
      const n = log.length;
      const K = 10; // multi-step horizon

      // Helper: run full Lyapunov analysis on a V(t) array
      const analyseLyapunov = (Vt, label) => {
        const dV1 = new Array(n - 1);
        for (let i = 0; i < n - 1; i++) dV1[i] = Vt[i + 1] - Vt[i];

        const dVk = new Array(n - K);
        for (let i = 0; i < n - K; i++) dVk[i] = Vt[i + K] - Vt[i];

        // Summary stats
        const vMean = Vt.reduce((a, b) => a + b, 0) / n;
        const vMin = Math.min(...Vt);
        const vMax = Math.max(...Vt);
        const vStd = Math.sqrt(Vt.reduce((a, v) => a + Math.pow(v - vMean, 2), 0) / n);

        // Single-step
        const dv1Mean = dV1.reduce((a, b) => a + b, 0) / dV1.length;
        const dv1Neg = dV1.filter(d => d < 0).length / dV1.length;

        // Multi-step
        const dvkMean = dVk.reduce((a, b) => a + b, 0) / dVk.length;
        const dvkNeg = dVk.filter(d => d < 0).length / dVk.length;

        // Percentile tiers
        const vSorted = [...Vt.slice(0, n - K)].sort((a, b) => a - b);
        const pctiles = [50, 60, 70, 80, 90, 95];
        const tierResults = [];

        for (const p of pctiles) {
          const threshIdx = Math.floor((p / 100) * vSorted.length);
          const threshold = vSorted[threshIdx];
          const dv1Above = [];
          for (let i = 0; i < n - 1; i++) {
            if (Vt[i] > threshold) dv1Above.push(dV1[i]);
          }
          const e1 = dv1Above.length > 0 ? dv1Above.reduce((a, b) => a + b, 0) / dv1Above.length : 0;

          const dvkAbove = [];
          for (let i = 0; i < n - K; i++) {
            if (Vt[i] > threshold) dvkAbove.push(dVk[i]);
          }
          const ek = dvkAbove.length > 0 ? dvkAbove.reduce((a, b) => a + b, 0) / dvkAbove.length : 0;

          tierResults.push({
            percentile: p, threshold,
            singleStep: { mean: e1, count: dv1Above.length },
            multiStep: { mean: ek, count: dvkAbove.length },
          });
        }

        // Monotonicity
        const mkVals = tierResults.map(t => t.multiStep.mean);
        let isMonotonic = true;
        for (let i = 1; i < mkVals.length; i++) {
          if (mkVals[i] > mkVals[i - 1] + 1e-12) { isMonotonic = false; break; }
        }

        // Median split
        const medianV = vSorted[Math.floor(vSorted.length / 2)];
        const dvkAboveMedian = [], dvkBelowMedian = [];
        for (let i = 0; i < n - K; i++) {
          if (Vt[i] > medianV) dvkAboveMedian.push(dVk[i]);
          else dvkBelowMedian.push(dVk[i]);
        }
        const medianSplit = {
          aboveMedian: dvkAboveMedian.length > 0 ? dvkAboveMedian.reduce((a, b) => a + b, 0) / dvkAboveMedian.length : 0,
          belowMedian: dvkBelowMedian.length > 0 ? dvkBelowMedian.reduce((a, b) => a + b, 0) / dvkBelowMedian.length : 0,
          aboveCount: dvkAboveMedian.length,
          belowCount: dvkBelowMedian.length,
        };

        const restoringForceConfirmed = tierResults.filter(t => t.multiStep.mean < 0).length >= 4;

        // Chart data (sampled)
        const chartSampleRate = Math.max(1, Math.floor(n / 500));
        const vChart = [];
        for (let i = 0; i < n; i += chartSampleRate) {
          vChart.push({ step: log[i].step, V: Vt[i] });
        }
        const dvChart = [];
        for (let i = 0; i < n - K; i += chartSampleRate) {
          dvChart.push({ step: log[i].step, dV1: i < dV1.length ? dV1[i] : 0, dVk: dVk[i] });
        }

        return {
          label,
          vStats: { mean: vMean, std: vStd, min: vMin, max: vMax },
          dv1Stats: { mean: dv1Mean, negFraction: dv1Neg },
          dvkStats: { mean: dvkMean, negFraction: dvkNeg },
          tierResults, isMonotonic, medianSplit, restoringForceConfirmed,
          vChart, dvChart,
        };
      };

      // ── Compute V(t) arrays for BOTH candidates ──
      const Vt_L = new Array(n);   // PRIMARY: (L − φ)² where L = sTemp/O
      const Vt_SM = new Array(n);  // SECONDARY: (S/M − φ)²
      for (let i = 0; i < n; i++) {
        Vt_L[i] = Math.pow(log[i].L - phi, 2);
        Vt_SM[i] = Math.pow(log[i].S / M - phi, 2);
      }

      const primary = analyseLyapunov(Vt_L, "V_L = (L − φ)²  where L = sTemp/O");
      const secondary = analyseLyapunov(Vt_SM, "V_SM = (S/M − φ)²");

      // ── Normalised gain per regime (on PRIMARY candidate) ──
      const dV1_L = new Array(n - 1);
      for (let i = 0; i < n - 1; i++) dV1_L[i] = Vt_L[i + 1] - Vt_L[i];

      const regimeGains = {};
      for (let i = 0; i < n - 1; i++) {
        const regime = log[i].regime || "default";
        if (!regimeGains[regime]) regimeGains[regime] = { gains: [], devs: [], dVs: [] };
        if (Vt_L[i] > 1e-15) {
          regimeGains[regime].gains.push(dV1_L[i] / Vt_L[i]);
        }
        regimeGains[regime].devs.push(Math.sqrt(Vt_L[i]));
        regimeGains[regime].dVs.push(dV1_L[i]);
      }

      const regimeStats = Object.entries(regimeGains).map(([regime, data]) => {
        const avgGain = data.gains.length > 0 ? data.gains.reduce((a, b) => a + b, 0) / data.gains.length : 0;
        const avgDev = data.devs.reduce((a, b) => a + b, 0) / data.devs.length;
        const avgDV = data.dVs.reduce((a, b) => a + b, 0) / data.dVs.length;
        return { regime, avgGain, avgDev, avgDV, count: data.gains.length };
      });

      const allGains = regimeStats.map(r => r.avgGain);
      const gainMean = allGains.reduce((a, b) => a + b, 0) / allGains.length;
      const gainStd = allGains.length > 1 ? Math.sqrt(allGains.reduce((a, v) => a + Math.pow(v - gainMean, 2), 0) / allGains.length) : 0;
      const gainCV = Math.abs(gainMean) > 1e-12 ? gainStd / Math.abs(gainMean) : 0;

      // ── Safety invariants ──
      let invariantsHeld = true;
      let invariantFail = "";
      for (let i = 0; i < n; i++) {
        if (log[i].S < 0) { invariantsHeld = false; invariantFail = `S < 0 at step ${log[i].step}`; break; }
        if (log[i].S > M * 1.0001) { invariantsHeld = false; invariantFail = `S > M at step ${log[i].step}`; break; }
      }

      // ── k-step drift curve (on PRIMARY candidate) ──
      // For k = 1..maxK, compute E[V(t+k) - V(t)] across all valid t.
      // Shows where cumulative correction overcomes noise floor.
      const maxK = Math.min(50, Math.floor(n / 2));
      const kDriftCurve = [];
      const medianVforDrift = [...Vt_L].sort((a, b) => a - b)[Math.floor(n / 2)];
      for (let k = 1; k <= maxK; k++) {
        let sum = 0;
        const count = n - k;
        for (let i = 0; i < count; i++) {
          sum += Vt_L[i + k] - Vt_L[i];
        }
        const meanDrift = sum / count;
        // Conditional: only when V_t > median (far from equilibrium)
        let condSum = 0, condCount = 0;
        for (let i = 0; i < count; i++) {
          if (Vt_L[i] > medianVforDrift) { condSum += Vt_L[i + k] - Vt_L[i]; condCount++; }
        }
        const condMean = condCount > 0 ? condSum / condCount : 0;
        kDriftCurve.push({ k, meanDrift, condMean, count, condCount });
      }
      // Find crossover: first k where meanDrift becomes consistently negative
      let crossoverK = null;
      for (let i = 0; i < kDriftCurve.length; i++) {
        if (kDriftCurve[i].meanDrift < 0) {
          // Check if it stays negative for at least 3 consecutive k values
          let stays = true;
          for (let j = i; j < Math.min(i + 3, kDriftCurve.length); j++) {
            if (kDriftCurve[j].meanDrift >= 0) { stays = false; break; }
          }
          if (stays) { crossoverK = kDriftCurve[i].k; break; }
        }
      }

      setStabilityResult({
        totalSteps: n,
        multiStepK: K,
        phi,
        primary,
        secondary,
        regimeStats,
        gainCV,
        gainMean,
        invariantsHeld,
        invariantFail,
        kDriftCurve,
        crossoverK,
        fieldDefs: [
          { field: "S", meaning: "Supply after step (sNew)" },
          { field: "L", meaning: "sTemp / O — band evaluation ratio (controller's regulated variable)" },
          { field: "lambda (λ)", meaning: "φ^(S/M) — progressive damping factor" },
          { field: "loadR", meaning: "S / M — normalised load ratio" },
          { field: "lyapV_L", meaning: "(L − φ)² — PRIMARY Lyapunov candidate (controller targets L = φ)" },
          { field: "lyapV_SM", meaning: "(S/M − φ)² — SECONDARY (valid only when O ≈ M)" },
        ],
      });
      setStabilityComputing(false);
    }, 50);
  }, []);

  const exportStabilityAnalysis = useCallback(() => {
    if (!stabilityResult || stabilityResult.error) return;
    const r = stabilityResult;
    const exportData = {
      exportedAt: new Date().toISOString(),
      exportType: "stability_analysis",
      config: configRef.current,
      mcap: mcapRef.current,
      totalSteps: r.totalSteps,
      multiStepHorizon: r.multiStepK,
      phi: r.phi,
      fieldDefinitions: r.fieldDefs,
      primary: {
        candidate: r.primary.label,
        description: "L = sTemp/O is the variable the controller regulates. This is the correct Lyapunov candidate.",
        vStatistics: r.primary.vStats,
        singleStepDV: r.primary.dv1Stats,
        multiStepDV: r.primary.dvkStats,
        medianSplitTest: r.primary.medianSplit,
        percentileTierResults: r.primary.tierResults.map(t => ({
          percentile: t.percentile, threshold: t.threshold,
          singleStepE_DV: t.singleStep.mean, multiStepE_DV: t.multiStep.mean,
          sampleCount: t.multiStep.count,
        })),
        isMonotonicRestoringForce: r.primary.isMonotonic,
        restoringForceConfirmed: r.primary.restoringForceConfirmed,
      },
      secondary: {
        candidate: r.secondary.label,
        description: "S/M is the load ratio. Only equivalent to L when O = M. Included for comparison.",
        vStatistics: r.secondary.vStats,
        singleStepDV: r.secondary.dv1Stats,
        multiStepDV: r.secondary.dvkStats,
        medianSplitTest: r.secondary.medianSplit,
        percentileTierResults: r.secondary.tierResults.map(t => ({
          percentile: t.percentile, threshold: t.threshold,
          singleStepE_DV: t.singleStep.mean, multiStepE_DV: t.multiStep.mean,
          sampleCount: t.multiStep.count,
        })),
        isMonotonicRestoringForce: r.secondary.isMonotonic,
        restoringForceConfirmed: r.secondary.restoringForceConfirmed,
      },
      normalisedGainPerRegime: r.regimeStats,
      gainCoefficientOfVariation: r.gainCV,
      meanNormalisedGain: r.gainMean,
      safetyInvariantsHeld: r.invariantsHeld,
      invariantFailure: r.invariantFail || null,
      kStepDriftCurve: {
        description: "E[V(t+k) - V(t)] for k=1..maxK on primary candidate. meanDrift = unconditional, condMean = conditional on V > median.",
        crossoverK: r.crossoverK,
        curve: r.kDriftCurve,
      },
      verdict: r.primary.restoringForceConfirmed && r.invariantsHeld
        ? "EMPIRICAL_LYAPUNOV_CONDITION_SATISFIED"
        : "PARTIAL_EVIDENCE",
    };
    const jsonStr = JSON.stringify(exportData, null, 2);
    deliverJSON(jsonStr, `pdm-stability-analysis-${r.totalSteps}steps.json`);
  }, [stabilityResult, deliverJSON]);

  // ═══════════════════════════════════════════════════════════════
  // PARAMETER STABILITY SWEEP — Heatmap of α across parameter space
  // ═══════════════════════════════════════════════════════════════
  const [sweepResult, setSweepResult] = useState(null);
  const [sweepProgress, setSweepProgress] = useState(null);

  const runParameterSweep = useCallback(() => {
    setSweepProgress({ pct: 0, msg: "Initialising..." });
    setSweepResult(null);

    // Run in chunks via setTimeout to keep UI responsive
    setTimeout(() => {
      const M = mcapRef.current;
      const basePhi = configRef.current.phiTarget;
      const baseBandLow = configRef.current.bandLow;
      const baseBandHigh = configRef.current.bandHigh;
      const currentBB = configRef.current.burnBase;
      const currentBVK = configRef.current.burnVelocityK;
      const sweepSeed = 42;
      const stepsPerRun = 2000;
      const burnIn = 1000; // discard first full regime cycle to remove initial transient

      // Grid
      const bbSteps = 25;
      const bvkSteps = 25;
      const bbMin = 0.0001, bbMax = 0.003;
      const bvkMin = 0.0, bvkMax = 0.5;
      const bbValues = Array.from({ length: bbSteps }, (_, i) => bbMin + (bbMax - bbMin) * i / (bbSteps - 1));
      const bvkValues = Array.from({ length: bvkSteps }, (_, i) => bvkMin + (bvkMax - bvkMin) * i / (bvkSteps - 1));

      // Regime sequence for consistent telemetry
      const regimes = REGIME_PRESETS.multiRegimeStress.regimes;

      const grid = [];
      let alphaMin = Infinity, alphaMax = -Infinity;
      const total = bbSteps * bvkSteps;
      let done = 0;

      const runBatch = (startIdx) => {
        const batchSize = Math.min(25, total - startIdx);

        for (let idx = startIdx; idx < startIdx + batchSize; idx++) {
          const bi = Math.floor(idx / bvkSteps);
          const vi = idx % bvkSteps;
          const bb = bbValues[bi];
          const bvk = bvkValues[vi];

          const cfg = { phiTarget: basePhi, bandLow: baseBandLow, bandHigh: baseBandHigh, burnBase: bb, burnVelocityK: bvk };
          const rng = mulberry32(sweepSeed);
          const s0 = M * (REGIME_PRESETS.multiRegimeStress.s0Pct / 100);
          let S = s0;

          // Run simulation
          let sumV = 0, sumDV = 0, countV = 0, countDV = 0, prevV = null;
          let diverged = false;

          for (let step = 1; step <= stepsPerRun; step++) {
            // Telemetry from regime sequence
            let cumulative = 0, blockIdx = 0;
            for (let r = 0; r < regimes.length; r++) {
              if (step <= cumulative + regimes[r].steps) { blockIdx = r; break; }
              cumulative += regimes[r].steps;
              if (r === regimes.length - 1) blockIdx = r;
            }
            const block = regimes[blockIdx];
            let O = block.O * (0.95 + rng() * 0.10);
            let V = block.V * (0.90 + rng() * 0.20);
            if (block.burstChance > 0 && rng() < block.burstChance) V *= (block.burstScale || 1.5);

            const { sNew, trace } = stepPDM(S, O, V, M, cfg);
            S = sNew;

            const Vlyap = Math.pow(trace.l - basePhi, 2);

            // Only accumulate stats after burn-in (first full regime cycle)
            if (step > burnIn) {
              sumV += Vlyap; countV++;
              if (prevV !== null) { sumDV += Vlyap - prevV; countDV++; }
            }
            if (step >= burnIn) prevV = Vlyap; // track prevV from one step before measurement window

            if (S <= 0 || S >= M * 0.9999) { diverged = true; }
          }

          const meanV = countV > 0 ? sumV / countV : 0;
          const meanDV = countDV > 0 ? sumDV / countDV : 0;
          const alpha = meanV > 1e-15 ? -meanDV / meanV : 0;

          if (alpha < alphaMin) alphaMin = alpha;
          if (alpha > alphaMax) alphaMax = alpha;

          grid.push({ bi, vi, bb, bvk, alpha, meanV, meanDV, diverged });
          done++;
        }

        if (done < total) {
          setSweepProgress({ pct: Math.round(100 * done / total), msg: `${done}/${total} configurations...` });
          setTimeout(() => runBatch(startIdx + batchSize), 0);
        } else {
          // Find current config position
          const currentBBIdx = bbValues.reduce((best, v, i) => Math.abs(v - currentBB) < Math.abs(bbValues[best] - currentBB) ? i : best, 0);
          const currentBVKIdx = bvkValues.reduce((best, v, i) => Math.abs(v - currentBVK) < Math.abs(bvkValues[best] - currentBVK) ? i : best, 0);

          setSweepResult({
            grid, bbValues, bvkValues, bbSteps, bvkSteps,
            alphaMin, alphaMax,
            currentBB, currentBVK, currentBBIdx, currentBVKIdx,
            stepsPerRun,
          });
          setSweepProgress(null);
        }
      };

      runBatch(0);
    }, 50);
  }, []);

  const exportSweepResult = useCallback(() => {
    if (!sweepResult) return;
    const r = sweepResult;
    const exportData = {
      exportedAt: new Date().toISOString(),
      exportType: "parameter_stability_sweep",
      config: configRef.current,
      mcap: mcapRef.current,
      stepsPerRun: r.stepsPerRun,
      burnIn: 1000,
      grid: { bbSteps: r.bbSteps, bvkSteps: r.bvkSteps },
      bbRange: [r.bbValues[0], r.bbValues[r.bbValues.length - 1]],
      bvkRange: [r.bvkValues[0], r.bvkValues[r.bvkValues.length - 1]],
      currentConfig: { burnBase: r.currentBB, burnVelocityK: r.currentBVK },
      alphaRange: { min: r.alphaMin, max: r.alphaMax },
      results: r.grid.map(g => ({ burnBase: g.bb, burnVelocityK: g.bvk, alpha: g.alpha, meanV: g.meanV, meanDV: g.meanDV, diverged: g.diverged })),
    };
    const jsonStr = JSON.stringify(exportData, null, 2);
    deliverJSON(jsonStr, `pdm-parameter-sweep-${r.bbSteps}x${r.bvkSteps}.json`);
  }, [sweepResult, deliverJSON]);

  // ═══════════════════════════════════════════════════════════════
  // RENDER HELPERS
  // ═══════════════════════════════════════════════════════════════

  const Metric = ({ label, value, sub, color, warning }) => (
    <div style={{
      background: C.panel, border: `1px solid ${warning ? C.red + "66" : C.border}`,
      borderRadius: "6px", padding: "12px 14px", flex: "1 1 140px", minWidth: "140px",
    }}>
      <div style={{ fontSize: "10px", color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px", fontFamily: mono }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: 700, color: color || C.text, fontFamily: mono, lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: "10px", color: warning ? C.red : C.muted, marginTop: "3px", fontFamily: mono }}>{sub}</div>}
    </div>
  );

  const Tab = ({ id, label }) => (
    <button onClick={() => setActiveTab(id)} style={{
      padding: "7px 14px", fontSize: "12px", fontWeight: activeTab === id ? 600 : 400,
      background: activeTab === id ? C.gold : "transparent",
      color: activeTab === id ? C.bg : C.dim,
      border: `1px solid ${activeTab === id ? C.gold : C.border}`,
      borderRadius: "5px", cursor: "pointer", fontFamily: mono, transition: "all 0.15s",
    }}>{label}</button>
  );

  const ttStyle = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: "6px", fontSize: "11px", fontFamily: mono };

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh", fontFamily: mono }}>
      {/* ─── HEADER ─────────────────────────────────────────────── */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "18px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: isRunning ? C.green : C.muted, boxShadow: isRunning ? `0 0 8px ${C.green}` : "none" }} />
            <span style={{ fontSize: "16px", fontWeight: 700, color: C.gold, letterSpacing: "0.04em" }}>
              PDM PERSONAL EDITION
            </span>
            <span style={{ fontSize: "11px", color: C.muted, marginLeft: "4px" }}>v1.0.1 Reference Simulator</span>
          </div>
          <div style={{ fontSize: "10px", color: C.muted, marginTop: "3px", marginLeft: "18px" }}>
            Mann Mechanics — UKIPO GB2513172.3 — Not production software — Not financial advice
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <div style={{
            padding: "4px 10px", borderRadius: "4px", fontSize: "11px", fontWeight: 600,
            background: accountingOk ? C.green + "18" : C.red + "22",
            color: accountingOk ? C.green : C.red,
            border: `1px solid ${accountingOk ? C.green + "44" : C.red + "66"}`,
          }}>
            LEDGER {accountingOk ? "✓" : `DRIFT: ${accountingDrift.toFixed(4)}`}
          </div>
        </div>
      </div>

      {/* ─── CONTROLS ───────────────────────────────────────────── */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "10px 24px", display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => { if (!initialized) initializeSystem(); setIsRunning(!isRunning); }} style={{
          padding: "7px 18px", fontSize: "12px", fontWeight: 600,
          background: isRunning ? C.red : C.green, color: "#fff",
          border: "none", borderRadius: "5px", cursor: "pointer", fontFamily: mono,
        }}>
          {isRunning ? "■ STOP" : "▶ RUN"}
        </button>
        <button onClick={() => initialized && tick()} disabled={isRunning} style={{
          padding: "7px 14px", fontSize: "12px",
          background: C.surface, color: isRunning ? C.muted : C.text,
          border: `1px solid ${C.border}`, borderRadius: "5px",
          cursor: isRunning ? "not-allowed" : "pointer", fontFamily: mono,
        }}>
          Step
        </button>
        <button onClick={initializeSystem} disabled={isRunning} style={{
          padding: "7px 14px", fontSize: "12px",
          background: "transparent", color: isRunning ? C.muted : C.orange,
          border: `1px solid ${isRunning ? C.border : C.orange}`, borderRadius: "5px",
          cursor: isRunning ? "not-allowed" : "pointer", fontFamily: mono,
        }}>
          Reset
        </button>

        <div style={{ width: "1px", height: "24px", background: C.border, margin: "0 4px" }} />

        <div style={{ fontSize: "11px", color: C.dim, display: "flex", alignItems: "center", gap: "4px" }}>
          Profile:
          <select value={profile} onChange={e => setProfile(e.target.value)} disabled={isRunning} style={{
            background: C.surface, color: C.text, border: `1px solid ${C.border}`,
            borderRadius: "4px", padding: "4px 8px", fontSize: "11px", fontFamily: mono,
          }}>
            {Object.entries(TELEMETRY_PROFILES).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: "11px", color: C.dim }}>
            Speed:
            <select value={cadenceMs} onChange={e => setCadenceMs(Number(e.target.value))} style={{
              background: C.surface, color: C.text, border: `1px solid ${C.border}`,
              borderRadius: "4px", padding: "3px 6px", fontSize: "11px", marginLeft: "4px", fontFamily: mono,
            }}>
              <option value={200}>Fast (200ms)</option>
              <option value={500}>Normal (500ms)</option>
              <option value={1000}>Slow (1s)</option>
              <option value={2000}>Very Slow (2s)</option>
            </select>
          </div>
          <div style={{ fontSize: "11px", color: C.dim }}>
            ×
            <select value={speedX} onChange={e => setSpeedX(Number(e.target.value))} style={{
              background: speedX > 1 ? C.orange + "22" : C.surface,
              color: speedX > 1 ? C.orange : C.text,
              border: `1px solid ${speedX > 1 ? C.orange : C.border}`,
              borderRadius: "4px", padding: "3px 6px", fontSize: "11px", marginLeft: "2px", fontFamily: mono,
            }}>
              {[1, 2, 5, 10, 25].map(n => <option key={n} value={n}>{n}×</option>)}
            </select>
          </div>
          <div style={{ fontSize: "11px", color: C.muted }}>Step {stepNum}</div>
        </div>
      </div>

      {/* ─── PROFILE DESCRIPTION ────────────────────────────────── */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "8px 24px", background: C.panel + "80" }}>
        <span style={{ fontSize: "10px", color: C.gold, fontWeight: 600 }}>
          {TELEMETRY_PROFILES[profile].label}:
        </span>
        <span style={{ fontSize: "10px", color: C.dim, marginLeft: "6px" }}>
          {TELEMETRY_PROFILES[profile].desc}
        </span>
      </div>

      {/* ─── TABS ───────────────────────────────────────────────── */}
      <div style={{ padding: "10px 24px", display: "flex", gap: "5px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
        <Tab id="dashboard" label="Dashboard" />
        <Tab id="stability" label="Stability Analysis" />
        <Tab id="history" label="Step History" />
        <Tab id="audit" label="Audit Chain" />
        <Tab id="config" label="Parameters" />
      </div>

      {/* ─── CONTENT ────────────────────────────────────────────── */}
      <div style={{ padding: "18px 24px" }}>

        {/* ═══ DASHBOARD ═══ */}
        {activeTab === "dashboard" && (
          <div>
            {/* Metrics Row */}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "18px" }}>
              <Metric label="Supply (S)" value={supply.toFixed(1)} sub={`${(supply / mcap * 100).toFixed(2)}% of M`} color={C.purple} />
              <Metric label="L Ratio" value={currentL !== null ? currentL.toFixed(6) : "—"} sub={bandStatus}
                color={bandStatus === "BELOW" ? C.red : bandStatus === "ABOVE" ? C.green : C.gold} />
              <Metric label="λ Damping" value={currentLambda.toFixed(6)} sub={`${((1 - currentLambda) * 100).toFixed(2)}% suppressed`} color={C.gold} />
              <Metric label="Total Burned" value={ledger.totalBurned.toFixed(2)} color={C.orange} />
              <Metric label="Total Minted" value={ledger.totalMinted.toFixed(2)} sub={`${ledger.mintEvents} events`} color={C.blue} />
              <Metric label="Net Δ" value={(ledger.totalMinted - ledger.totalBurned).toFixed(2)}
                sub={`S₀ = ${s0.toFixed(0)} → S = ${supply.toFixed(1)}`}
                color={(ledger.totalMinted - ledger.totalBurned) >= 0 ? C.green : C.red} />
            </div>

            {/* Accounting Identity */}
            <div style={{
              background: C.panel, border: `1px solid ${accountingOk ? C.green + "33" : C.red + "66"}`,
              borderRadius: "6px", padding: "10px 14px", marginBottom: "18px",
              fontSize: "11px", color: C.dim, display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "center",
            }}>
              <span style={{ color: C.gold, fontWeight: 600 }}>ACCOUNTING IDENTITY</span>
              <span>S₀ ({s0.toFixed(1)}) − burned ({ledger.totalBurned.toFixed(2)}) + minted ({ledger.totalMinted.toFixed(2)}) = {expectedS.toFixed(2)}</span>
              <span>Actual S = {supply.toFixed(2)}</span>
              <span style={{ color: accountingOk ? C.green : C.red, fontWeight: 600 }}>
                {accountingOk ? "✓ Balanced" : `✗ Drift: ${accountingDrift.toFixed(6)}`}
              </span>
            </div>

            {/* L Ratio Chart */}
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px", marginBottom: "14px" }}>
              <div style={{ fontSize: "11px", color: C.muted, marginBottom: "6px" }}>L RATIO — Stability Band [{config.bandLow}, {config.bandHigh}]</div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={history.slice(-100)} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="step" tick={{ fill: C.muted, fontSize: 10 }} />
                  <YAxis tick={{ fill: C.muted, fontSize: 10 }}
                    domain={[
                      (dataMin) => Math.max(0, Math.min(dataMin, config.bandLow) - 0.05),
                      (dataMax) => Math.max(dataMax, config.bandHigh) + 0.05,
                    ]} />
                  <ReferenceLine y={config.phiTarget} stroke={C.gold} strokeWidth={2} label={{ value: "φ", fill: C.gold, fontSize: 10 }} />
                  <ReferenceLine y={config.bandLow} stroke={C.red} strokeDasharray="5 5" strokeWidth={1} />
                  <ReferenceLine y={config.bandHigh} stroke={C.green} strokeDasharray="5 5" strokeWidth={1} />
                  <Line type="monotone" dataKey="l" stroke={C.cyan} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Tooltip contentStyle={ttStyle} formatter={(v) => [v?.toFixed(8), "L"]} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Supply + Mint/Burn */}
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "14px" }}>
              <div style={{ flex: "1 1 380px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px" }}>
                <div style={{ fontSize: "11px", color: C.muted, marginBottom: "6px" }}>SUPPLY TRAJECTORY</div>
                <ResponsiveContainer width="100%" height={150}>
                  <AreaChart data={history.slice(-100)} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                    <XAxis dataKey="step" tick={{ fill: C.muted, fontSize: 10 }} />
                    <YAxis tick={{ fill: C.muted, fontSize: 10 }} domain={[0, mcap]} />
                    <ReferenceLine y={mcap} stroke={C.red} strokeDasharray="8 4" strokeWidth={1} label={{ value: "M", fill: C.red, fontSize: 10 }} />
                    <Area type="monotone" dataKey="sNew" stroke={C.purple} fill={C.purple} fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
                    <Tooltip contentStyle={ttStyle} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: "1 1 380px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px" }}>
                <div style={{ fontSize: "11px", color: C.muted, marginBottom: "6px" }}>MINT vs BURN PER STEP</div>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={history.slice(-80)} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                    <XAxis dataKey="step" tick={{ fill: C.muted, fontSize: 10 }} />
                    <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                    <Bar dataKey="delta" name="Mint (Δ)" isAnimationActive={false}>
                      {history.slice(-80).map((e, i) => <Cell key={i} fill={e.delta > 0 ? C.blue : "transparent"} />)}
                    </Bar>
                    <Bar dataKey="burnAmount" name="Burn" isAnimationActive={false}>
                      {history.slice(-80).map((e, i) => <Cell key={i} fill={C.orange} fillOpacity={0.7} />)}
                    </Bar>
                    <Tooltip contentStyle={ttStyle} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Lambda + Telemetry */}
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "14px" }}>
              <div style={{ flex: "1 1 380px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px" }}>
                <div style={{ fontSize: "11px", color: C.muted, marginBottom: "6px" }}>λ = φ^(S/M) — Progressive Resistance (Theorem 3)</div>
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={history.slice(-100)} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                    <XAxis dataKey="step" tick={{ fill: C.muted, fontSize: 10 }} />
                    <YAxis domain={[0, 1]} tick={{ fill: C.muted, fontSize: 10 }} />
                    <Line type="monotone" dataKey="lambda" stroke={C.gold} strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Tooltip contentStyle={ttStyle} formatter={(v) => [v?.toFixed(8), "λ"]} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: "1 1 380px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px" }}>
                <div style={{ fontSize: "11px", color: C.muted, marginBottom: "6px" }}>TELEMETRY — O (obligation) and V (activity)</div>
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={history.slice(-100)} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                    <XAxis dataKey="step" tick={{ fill: C.muted, fontSize: 10 }} />
                    <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                    <Line type="monotone" dataKey="oi" stroke={C.cyan} strokeWidth={1.5} dot={false} isAnimationActive={false} name="O" />
                    <Line type="monotone" dataKey="vTotal" stroke={C.orange} strokeWidth={1.5} dot={false} isAnimationActive={false} name="V" />
                    <Tooltip contentStyle={ttStyle} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Step telemetry panel */}
            {lastTrace && (
              <div style={{ background: C.panel, border: `1px solid ${C.gold}33`, borderRadius: "6px", padding: "14px" }}>
                <div style={{ fontSize: "11px", color: C.gold, marginBottom: "8px", fontWeight: 600 }}>
                  STEP {lastTrace.step} — Full StepPDM Trace
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "6px", fontSize: "11px" }}>
                  {[
                    { k: "S_prev", v: lastTrace.sPrev?.toFixed(2), c: C.purple },
                    { k: "O (input)", v: lastTrace.oi?.toFixed(2), c: C.cyan },
                    { k: "V (input)", v: lastTrace.vTotal?.toFixed(2), c: C.orange },
                    { k: "ν (velocity)", v: lastTrace.velocity?.toFixed(6), c: C.dim },
                    { k: "r (burn rate)", v: lastTrace.burnRate?.toFixed(6), c: C.dim },
                    { k: "Burn", v: lastTrace.burnAmount?.toFixed(6), c: C.orange },
                    { k: "S_temp", v: lastTrace.sTemp?.toFixed(2), c: C.dim },
                    { k: "L = S/O", v: lastTrace.l?.toFixed(8), c: lastTrace.l < config.bandLow ? C.red : C.gold },
                    { k: "Band", v: lastTrace.band, c: lastTrace.band === "BELOW" ? C.red : lastTrace.band === "ABOVE" ? C.green : C.gold },
                    { k: "mintRaw", v: lastTrace.mintRaw?.toFixed(2), c: C.blue },
                    { k: "λ (damping)", v: lastTrace.lambda?.toFixed(8), c: C.gold },
                    { k: "Δ (mint)", v: lastTrace.delta?.toFixed(4), c: lastTrace.delta > 0 ? C.blue : C.muted },
                    { k: "S_new", v: lastTrace.sNew?.toFixed(2), c: C.purple },
                    { k: "Clamped S", v: lastTrace.clampedS ? "YES" : "no", c: lastTrace.clampedS ? C.red : C.muted },
                    { k: "Clamped Cap", v: lastTrace.clampedCap ? "YES" : "no", c: lastTrace.clampedCap ? C.red : C.muted },
                  ].map(({ k, v, c }) => (
                    <div key={k} style={{ padding: "5px 8px", background: C.surface, borderRadius: "4px" }}>
                      <div style={{ color: C.muted, fontSize: "9px", marginBottom: "2px" }}>{k}</div>
                      <div style={{ color: c, fontWeight: 600 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ STABILITY ANALYSIS ═══ */}
        {activeTab === "stability" && (
          <div>
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px", marginBottom: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
                <div>
                  <div style={{ fontSize: "13px", color: C.gold, fontWeight: 700, marginBottom: "4px" }}>LYAPUNOV STABILITY ANALYSIS</div>
                  <div style={{ fontSize: "10px", color: C.dim }}>
                    Computes V(t) = (S/M − φ)², single-step and {10}-step ΔV, percentile-tier conditional expectations,
                    normalised gain per regime, and safety invariant verification across the full run.
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <span style={{ fontSize: "10px", color: C.muted }}>{streamLogCount} steps available</span>
                  <button onClick={computeStabilityAnalysis} disabled={stabilityComputing || streamLogCount < 50} style={{
                    padding: "8px 20px", fontSize: "12px", fontWeight: 600,
                    background: streamLogCount >= 50 ? C.gold : C.muted,
                    color: C.bg, border: "none", borderRadius: "5px",
                    cursor: streamLogCount >= 50 ? "pointer" : "not-allowed", fontFamily: mono,
                  }}>
                    {stabilityComputing ? "Computing..." : "Run Analysis"}
                  </button>
                  {stabilityResult && !stabilityResult.error && (
                    <button onClick={exportStabilityAnalysis} style={{
                      padding: "8px 16px", fontSize: "12px", fontWeight: 600,
                      background: C.surface, color: C.gold,
                      border: `1px solid ${C.gold}44`, borderRadius: "5px",
                      cursor: "pointer", fontFamily: mono,
                    }}>
                      Export Analysis ↗
                    </button>
                  )}
                </div>
              </div>
            </div>

            {stabilityResult && stabilityResult.error && (
              <div style={{ background: C.red + "18", border: `1px solid ${C.red}44`, borderRadius: "6px", padding: "14px", color: C.red, fontSize: "12px" }}>
                {stabilityResult.error}
              </div>
            )}

            {stabilityResult && !stabilityResult.error && (() => {
              const r = stabilityResult;
              const p = r.primary;   // L-based (correct)
              const s = r.secondary; // S/M-based (comparison)
              const sciNotation = (v, d = 4) => {
                if (Math.abs(v) < 1e-15) return "0";
                const exp = Math.floor(Math.log10(Math.abs(v)));
                const mantissa = v / Math.pow(10, exp);
                return `${mantissa.toFixed(d - 1)}×10^${exp}`;
              };
              const fmtSci = (v) => Math.abs(v) < 0.0001 ? sciNotation(v) : v.toFixed(8);
              const StatRow = ({ label, value, color }) => (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.border}22` }}>
                  <span style={{ fontSize: "11px", color: C.dim }}>{label}</span>
                  <span style={{ fontSize: "11px", color: color || C.text, fontWeight: 600 }}>{value}</span>
                </div>
              );

              // Reusable panel for either candidate
              const CandidatePanel = ({ data, isPrimary }) => (
                <div style={{ marginBottom: "14px" }}>
                  <div style={{
                    background: isPrimary ? C.gold + "12" : C.surface,
                    border: `1px solid ${isPrimary ? C.gold + "33" : C.border}`,
                    borderRadius: "6px", padding: "10px 14px", marginBottom: "10px",
                  }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: isPrimary ? C.gold : C.dim }}>
                      {isPrimary ? "PRIMARY" : "SECONDARY"}: {data.label}
                    </div>
                    <div style={{ fontSize: "10px", color: C.dim, marginTop: "2px" }}>
                      {isPrimary
                        ? "L = sTemp/O is the variable the controller regulates. This is the correct Lyapunov candidate for PDM."
                        : "S/M is the load ratio. Only equivalent to L when O = M. Shown for comparison."}
                    </div>
                  </div>

                  {/* Metrics */}
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "10px" }}>
                    <Metric label="V(t) Mean" value={fmtSci(data.vStats.mean)} sub={`std: ${fmtSci(data.vStats.std)}`} color={C.cyan} />
                    <Metric label="V(t) Range" value={`${fmtSci(data.vStats.min)} — ${fmtSci(data.vStats.max)}`} color={C.purple} />
                    <Metric label="E[ΔV] 1-step" value={fmtSci(data.dv1Stats.mean)} sub={`${(data.dv1Stats.negFraction * 100).toFixed(1)}% negative`}
                      color={data.dv1Stats.mean <= 0 ? C.green : C.orange} />
                    <Metric label={`E[ΔV] ${r.multiStepK}-step`} value={fmtSci(data.dvkStats.mean)} sub={`${(data.dvkStats.negFraction * 100).toFixed(1)}% negative`}
                      color={data.dvkStats.mean <= 0 ? C.green : C.orange} />
                    <Metric label="Restoring Force" value={data.restoringForceConfirmed ? "CONFIRMED" : "NOT CONFIRMED"}
                      sub={data.isMonotonic ? "Monotonic" : "Non-monotonic"}
                      color={data.restoringForceConfirmed ? C.green : C.orange} />
                  </div>

                  {/* V(t) chart */}
                  <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px", marginBottom: "10px" }}>
                    <div style={{ fontSize: "11px", color: C.muted, marginBottom: "6px" }}>{data.label} — TRAJECTORY</div>
                    <ResponsiveContainer width="100%" height={150}>
                      <AreaChart data={data.vChart} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                        <XAxis dataKey="step" tick={{ fill: C.muted, fontSize: 10 }} />
                        <YAxis tick={{ fill: C.muted, fontSize: 10 }} tickFormatter={v => v.toExponential(1)} />
                        <Area type="monotone" dataKey="V" stroke={isPrimary ? C.cyan : C.muted} fill={isPrimary ? C.cyan : C.muted} fillOpacity={0.15} strokeWidth={1.5} isAnimationActive={false} />
                        <Tooltip contentStyle={ttStyle} formatter={(v) => [v?.toExponential(6), "V(t)"]} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Percentile tier table */}
                  <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px", marginBottom: "10px" }}>
                    <div style={{ fontSize: "11px", color: isPrimary ? C.gold : C.dim, fontWeight: 600, marginBottom: "4px" }}>
                      {r.multiStepK}-STEP CONDITIONAL E[ΔV | V {">"} threshold]
                    </div>
                    <div style={{ fontSize: "10px", color: C.dim, marginBottom: "8px" }}>
                      {data.isMonotonic
                        ? "✓ MONOTONIC — Restoring force increases with deviation"
                        : "△ Non-monotonic — restoring force pattern is irregular"}
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                          <th style={{ padding: "5px 6px", textAlign: "left", color: C.muted }}>Tier</th>
                          <th style={{ padding: "5px 6px", textAlign: "right", color: C.muted }}>Threshold</th>
                          <th style={{ padding: "5px 6px", textAlign: "right", color: C.muted }}>E[ΔV] 1-step</th>
                          <th style={{ padding: "5px 6px", textAlign: "right", color: C.muted }}>E[ΔV] {r.multiStepK}-step</th>
                          <th style={{ padding: "5px 6px", textAlign: "right", color: C.muted }}>n</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.tierResults.map(t => (
                          <tr key={t.percentile} style={{ borderBottom: `1px solid ${C.border}22` }}>
                            <td style={{ padding: "5px 6px", color: C.text }}>{t.percentile}th</td>
                            <td style={{ padding: "5px 6px", textAlign: "right", color: C.dim }}>{t.threshold.toExponential(4)}</td>
                            <td style={{ padding: "5px 6px", textAlign: "right", color: t.singleStep.mean < 0 ? C.green : C.red, fontWeight: 600 }}>
                              {t.singleStep.mean.toExponential(4)}
                            </td>
                            <td style={{ padding: "5px 6px", textAlign: "right", color: t.multiStep.mean < 0 ? C.green : C.red, fontWeight: 600 }}>
                              {t.multiStep.mean.toExponential(4)}
                            </td>
                            <td style={{ padding: "5px 6px", textAlign: "right", color: C.muted }}>{t.multiStep.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Median split */}
                  <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px" }}>
                    <div style={{ fontSize: "11px", color: C.dim, fontWeight: 600, marginBottom: "6px" }}>MEDIAN SPLIT ({r.multiStepK}-step)</div>
                    <StatRow label="Above median E[ΔV]" value={fmtSci(data.medianSplit.aboveMedian)} color={data.medianSplit.aboveMedian < 0 ? C.green : C.red} />
                    <StatRow label="Below median E[ΔV]" value={fmtSci(data.medianSplit.belowMedian)} color={C.dim} />
                    <StatRow label="Counts" value={`${data.medianSplit.aboveCount} above / ${data.medianSplit.belowCount} below`} />
                  </div>
                </div>
              );

              return (
                <div>
                  {/* ── VERDICT BANNER ── */}
                  <div style={{
                    background: p.restoringForceConfirmed && r.invariantsHeld ? C.green + "12" : C.orange + "12",
                    border: `1px solid ${p.restoringForceConfirmed && r.invariantsHeld ? C.green + "44" : C.orange + "44"}`,
                    borderRadius: "6px", padding: "12px 16px", marginBottom: "14px",
                    display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap",
                  }}>
                    <span style={{ fontSize: "18px" }}>{p.restoringForceConfirmed && r.invariantsHeld ? "✓" : "△"}</span>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: p.restoringForceConfirmed && r.invariantsHeld ? C.green : C.orange }}>
                        {p.restoringForceConfirmed && r.invariantsHeld
                          ? "EMPIRICAL LYAPUNOV CONDITION SATISFIED"
                          : "PARTIAL EVIDENCE — FURTHER ANALYSIS NEEDED"}
                      </div>
                      <div style={{ fontSize: "10px", color: C.dim, marginTop: "2px" }}>
                        {r.totalSteps.toLocaleString()} steps | K={r.multiStepK} | φ={r.phi} | Primary: V = (L − φ)² where L = sTemp/O
                        {p.isMonotonic ? " | Monotonic restoring force" : ""}
                      </div>
                    </div>
                  </div>

                  {/* ── FIELD DEFINITIONS ── */}
                  <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px", marginBottom: "14px" }}>
                    <div style={{ fontSize: "11px", color: C.gold, fontWeight: 600, marginBottom: "8px" }}>FIELD DEFINITIONS</div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                          <th style={{ padding: "5px 8px", textAlign: "left", color: C.muted }}>Export Field</th>
                          <th style={{ padding: "5px 8px", textAlign: "left", color: C.muted }}>Definition</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.fieldDefs.map(f => (
                          <tr key={f.field} style={{ borderBottom: `1px solid ${C.border}22` }}>
                            <td style={{ padding: "5px 8px", color: C.cyan, fontWeight: 600 }}>{f.field}</td>
                            <td style={{ padding: "5px 8px", color: C.dim }}>{f.meaning}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* ── SAFETY INVARIANTS ── */}
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "14px" }}>
                    <Metric label="Safety Invariants" value={r.invariantsHeld ? "ALL HELD" : "VIOLATION"}
                      sub={r.invariantsHeld ? "S ≥ 0, S ≤ M across all steps" : r.invariantFail}
                      color={r.invariantsHeld ? C.green : C.red} warning={!r.invariantsHeld} />
                    <Metric label="Total Steps" value={r.totalSteps.toLocaleString()} color={C.text} />
                  </div>

                  {/* ── PRIMARY CANDIDATE ── */}
                  <CandidatePanel data={p} isPrimary={true} />

                  {/* ── SECONDARY CANDIDATE ── */}
                  <CandidatePanel data={s} isPrimary={false} />

                  {/* ── NORMALISED GAIN PER REGIME ── */}
                  <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px", marginBottom: "14px" }}>
                    <div style={{ fontSize: "11px", color: C.gold, fontWeight: 600, marginBottom: "4px" }}>
                      NORMALISED GAIN PER REGIME — ΔV/V on primary candidate (state-dependent damping test)
                    </div>
                    <div style={{ fontSize: "10px", color: C.dim, marginBottom: "10px" }}>
                      {r.gainCV < 0.5
                        ? "Gain CV: " + r.gainCV.toFixed(3) + " — CONSISTENT across regimes (proportional controller)"
                        : "Gain CV: " + r.gainCV.toFixed(3) + " — VARIES across regimes (nonlinear / regime-dependent dynamics)"}
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                          <th style={{ padding: "5px 8px", textAlign: "left", color: C.muted }}>Regime</th>
                          <th style={{ padding: "5px 8px", textAlign: "right", color: C.muted }}>Avg Gain (ΔV/V)</th>
                          <th style={{ padding: "5px 8px", textAlign: "right", color: C.muted }}>Avg |L − φ|</th>
                          <th style={{ padding: "5px 8px", textAlign: "right", color: C.muted }}>Avg ΔV</th>
                          <th style={{ padding: "5px 8px", textAlign: "right", color: C.muted }}>Steps</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.regimeStats.map(rs => (
                          <tr key={rs.regime} style={{ borderBottom: `1px solid ${C.border}22` }}>
                            <td style={{ padding: "5px 8px", color: C.text }}>{rs.regime}</td>
                            <td style={{ padding: "5px 8px", textAlign: "right", color: rs.avgGain < 0 ? C.green : C.orange, fontWeight: 600 }}>
                              {rs.avgGain.toFixed(6)}
                            </td>
                            <td style={{ padding: "5px 8px", textAlign: "right", color: C.purple }}>{rs.avgDev.toExponential(4)}</td>
                            <td style={{ padding: "5px 8px", textAlign: "right", color: rs.avgDV < 0 ? C.green : C.orange }}>{rs.avgDV.toExponential(4)}</td>
                            <td style={{ padding: "5px 8px", textAlign: "right", color: C.muted }}>{rs.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* ── K-STEP DRIFT CURVE ── */}
                  {r.kDriftCurve && r.kDriftCurve.length > 0 && (
                    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px", marginBottom: "14px" }}>
                      <div style={{ fontSize: "11px", color: C.gold, fontWeight: 600, marginBottom: "4px" }}>
                        K-STEP DRIFT CURVE — E[V(t+k) − V(t)] for k = 1..{r.kDriftCurve.length}
                      </div>
                      <div style={{ fontSize: "10px", color: C.dim, marginBottom: "10px" }}>
                        Shows how correction accumulates over time. Grey = unconditional, Cyan = conditional on V {">"} median (far from equilibrium).
                        {r.crossoverK
                          ? ` Crossover at k=${r.crossoverK}: unconditional drift becomes consistently negative.`
                          : " No consistent crossover found — conditional drift may still be negative."}
                      </div>
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={r.kDriftCurve} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                          <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                          <XAxis dataKey="k" tick={{ fill: C.muted, fontSize: 10 }} label={{ value: "k (steps)", fill: C.muted, fontSize: 10, position: "insideBottom", offset: -2 }} />
                          <YAxis tick={{ fill: C.muted, fontSize: 10 }} tickFormatter={v => v.toExponential(1)} />
                          <ReferenceLine y={0} stroke={C.gold} strokeWidth={1} />
                          <Line type="monotone" dataKey="meanDrift" stroke={C.muted} strokeWidth={1.5} dot={false} isAnimationActive={false} name="E[ΔV] unconditional" />
                          <Line type="monotone" dataKey="condMean" stroke={C.cyan} strokeWidth={2} dot={false} isAnimationActive={false} name="E[ΔV] | V > median" />
                          <Tooltip contentStyle={ttStyle} formatter={(v, name) => [v?.toExponential(6), name]} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* ── INTERPRETATION ── */}
                  <div style={{ background: C.panel, border: `1px solid ${C.gold}22`, borderRadius: "6px", padding: "14px" }}>
                    <div style={{ fontSize: "11px", color: C.gold, fontWeight: 600, marginBottom: "8px" }}>INTERPRETATION</div>
                    <div style={{ fontSize: "11px", color: C.dim, lineHeight: 1.8 }}>
                      <div style={{ marginBottom: "8px" }}>
                        <span style={{ color: C.cyan, fontWeight: 600 }}>Why two candidates:</span> The controller regulates L = sTemp/O, not S/M.
                        When O varies across regimes, S/M at equilibrium is not φ — it is φ×O/M, which changes per regime.
                        The L-based candidate V = (L − φ)² correctly measures deviation from the controller's actual target.
                        The S/M-based candidate is only valid when O ≈ M.
                      </div>
                      <div style={{ marginBottom: "8px" }}>
                        <span style={{ color: C.cyan, fontWeight: 600 }}>Primary result:</span>
                        {p.restoringForceConfirmed
                          ? ` V_L shows monotonic restoring force across percentile tiers. E[ΔV | V > 90th] is strongly negative. This is empirical evidence of stochastic Lyapunov stability on the correct state variable.`
                          : ` V_L does not yet show confirmed restoring force. Consider longer runs or wider regime variation.`}
                      </div>
                      <div>
                        <span style={{ color: C.cyan, fontWeight: 600 }}>Note:</span> Empirical evidence supports but does not replace a formal proof.
                        The proof requires showing V(L_(t+1)) − V(L_t) ≤ −αV(L_t) algebraically from the StepPDM transition function.
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── PARAMETER STABILITY SWEEP ── */}
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px", marginTop: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "10px" }}>
                <div>
                  <div style={{ fontSize: "12px", color: C.gold, fontWeight: 700 }}>PARAMETER STABILITY HEATMAP</div>
                  <div style={{ fontSize: "10px", color: C.dim, marginTop: "2px" }}>
                    Sweeps burnBase × burnVelocityK grid (625 configs, 2000 steps each, 1000-step burn-in). Shows contraction coefficient α across parameter space.
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  {sweepProgress && (
                    <span style={{ fontSize: "10px", color: C.orange }}>{sweepProgress.pct}% — {sweepProgress.msg}</span>
                  )}
                  <button onClick={runParameterSweep} disabled={!!sweepProgress} style={{
                    padding: "8px 18px", fontSize: "12px", fontWeight: 600,
                    background: sweepProgress ? C.muted : C.gold, color: C.bg,
                    border: "none", borderRadius: "5px",
                    cursor: sweepProgress ? "not-allowed" : "pointer", fontFamily: mono,
                  }}>
                    {sweepProgress ? "Sweeping..." : "Run Sweep"}
                  </button>
                  {sweepResult && (
                    <button onClick={exportSweepResult} style={{
                      padding: "8px 14px", fontSize: "12px", fontWeight: 600,
                      background: C.surface, color: C.gold,
                      border: `1px solid ${C.gold}44`, borderRadius: "5px",
                      cursor: "pointer", fontFamily: mono,
                    }}>Export ↗</button>
                  )}
                </div>
              </div>

              {sweepResult && (() => {
                const sw = sweepResult;
                // Color mapping: red (unstable) → black (boundary) → green (stable)
                const getColor = (alpha) => {
                  if (alpha <= 0) {
                    const t = Math.min(1, Math.abs(alpha) / Math.max(0.001, Math.abs(sw.alphaMin)));
                    const r = Math.round(100 + 155 * t);
                    return `rgb(${r},30,30)`;
                  }
                  const t = Math.min(1, alpha / Math.max(0.001, sw.alphaMax));
                  const g = Math.round(60 + 140 * t);
                  return `rgb(20,${g},40)`;
                };
                const cellW = Math.max(12, Math.floor(600 / sw.bvkSteps));
                const cellH = Math.max(12, Math.floor(400 / sw.bbSteps));

                // Build lookup
                const lookup = {};
                sw.grid.forEach(g => { lookup[`${g.bi}-${g.vi}`] = g; });

                return (
                  <div>
                    <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
                      {/* Heatmap */}
                      <div style={{ flex: "1 1 auto" }}>
                        <div style={{ fontSize: "10px", color: C.muted, marginBottom: "4px" }}>
                          ← burnVelocityK →
                        </div>
                        <div style={{ display: "flex", gap: "2px" }}>
                          <div style={{ fontSize: "9px", color: C.muted, writingMode: "vertical-rl", textAlign: "center", paddingRight: "4px" }}>
                            ← burnBase →
                          </div>
                          <div>
                            {Array.from({ length: sw.bbSteps }).reverse().map((_, ri) => {
                              const bi = sw.bbSteps - 1 - ri;
                              return (
                                <div key={bi} style={{ display: "flex", gap: "1px", marginBottom: "1px" }}>
                                  {Array.from({ length: sw.bvkSteps }).map((_, vi) => {
                                    const cell = lookup[`${bi}-${vi}`];
                                    if (!cell) return <div key={vi} style={{ width: cellW, height: cellH, background: C.surface }} />;
                                    const isCurrent = bi === sw.currentBBIdx && vi === sw.currentBVKIdx;
                                    return (
                                      <div key={vi} title={`B=${cell.bb.toFixed(6)} k=${cell.bvk.toFixed(3)} α=${cell.alpha.toExponential(3)}`} style={{
                                        width: cellW, height: cellH,
                                        background: getColor(cell.alpha),
                                        border: isCurrent ? `2px solid ${C.gold}` : "none",
                                        borderRadius: isCurrent ? "2px" : "0",
                                        cursor: "crosshair",
                                      }} />
                                    );
                                  })}
                                </div>
                              );
                            })}
                            {/* Axis labels */}
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: C.muted, marginTop: "2px" }}>
                              <span>{sw.bvkValues[0].toFixed(2)}</span>
                              <span>{sw.bvkValues[Math.floor(sw.bvkSteps / 2)].toFixed(2)}</span>
                              <span>{sw.bvkValues[sw.bvkValues.length - 1].toFixed(2)}</span>
                            </div>
                          </div>
                          {/* Y-axis labels */}
                          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", fontSize: "9px", color: C.muted, marginLeft: "4px" }}>
                            <span>{sw.bbValues[sw.bbValues.length - 1].toFixed(4)}</span>
                            <span>{sw.bbValues[Math.floor(sw.bbSteps / 2)].toFixed(4)}</span>
                            <span>{sw.bbValues[0].toFixed(4)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Legend and stats */}
                      <div style={{ flex: "0 0 200px" }}>
                        <div style={{ fontSize: "11px", color: C.muted, marginBottom: "8px" }}>LEGEND</div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", marginBottom: "4px" }}>
                          <div style={{ width: 14, height: 14, background: "rgb(20,200,40)", borderRadius: "2px" }} />
                          <span style={{ color: C.green }}>Strongly stable (α {">"} 0)</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", marginBottom: "4px" }}>
                          <div style={{ width: 14, height: 14, background: "rgb(20,60,40)", borderRadius: "2px" }} />
                          <span style={{ color: C.dim }}>Weakly stable</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", marginBottom: "4px" }}>
                          <div style={{ width: 14, height: 14, background: "rgb(255,30,30)", borderRadius: "2px" }} />
                          <span style={{ color: C.red }}>Unstable (α {"<"} 0)</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", marginBottom: "8px" }}>
                          <div style={{ width: 14, height: 14, border: `2px solid ${C.gold}`, borderRadius: "2px" }} />
                          <span style={{ color: C.gold }}>Current config</span>
                        </div>

                        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: "8px", fontSize: "10px", color: C.dim, lineHeight: 1.8 }}>
                          <div>α range: {sw.alphaMin.toExponential(3)} to {sw.alphaMax.toExponential(3)}</div>
                          <div>Current B: {sw.currentBB}</div>
                          <div>Current k: {sw.currentBVK}</div>
                          <div>Configs: {sw.grid.length}</div>
                          <div>Steps/run: {sw.stepsPerRun}</div>
                          <div>Stable: {sw.grid.filter(g => g.alpha > 0).length}/{sw.grid.length}</div>
                          <div>Unstable: {sw.grid.filter(g => g.alpha <= 0).length}/{sw.grid.length}</div>
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: "10px", padding: "8px", background: C.surface, borderRadius: "4px", fontSize: "10px", color: C.dim, lineHeight: 1.6 }}>
                      Hover over cells to see exact values. Gold-bordered cell marks your current configuration.
                      Green region = stable (α {">"} 0), red region = unstable (α {"<"} 0). The boundary between green and red is the bifurcation surface.
                      {sw.grid.filter(g => g.alpha > 0 && g.bi === sw.currentBBIdx && g.vi === sw.currentBVKIdx).length > 0
                        ? " Your current parameters sit inside the stable region."
                        : ""}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ═══ HISTORY ═══ */}
        {activeTab === "history" && (
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px", overflowX: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
              <div style={{ fontSize: "11px", color: C.muted }}>
                STEP HISTORY — {history.length} in window (last 300) | {streamLogCount} total this run
              </div>
              <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={exportHistory} disabled={history.length === 0} style={{
                  padding: "5px 12px", fontSize: "10px",
                  background: history.length > 0 ? C.surface : C.panel,
                  color: history.length > 0 ? C.text : C.muted,
                  border: `1px solid ${C.border}`, borderRadius: "4px",
                  cursor: history.length > 0 ? "pointer" : "not-allowed", fontFamily: mono,
                }}>Export Window</button>
                <button onClick={exportFullRun} disabled={streamLogCount === 0} style={{
                  padding: "5px 12px", fontSize: "10px",
                  background: streamLogCount > 0 ? C.gold + "18" : C.panel,
                  color: streamLogCount > 0 ? C.gold : C.muted,
                  border: `1px solid ${streamLogCount > 0 ? C.gold + "44" : C.border}`, borderRadius: "4px",
                  cursor: streamLogCount > 0 ? "pointer" : "not-allowed", fontFamily: mono,
                }}>Export Full Run ↗ ({streamLogCount})</button>
                {exportStatus && (
                  <span style={{
                    fontSize: "10px", padding: "3px 8px", borderRadius: "3px",
                    background: exportStatus.ok ? C.green + "18" : C.red + "18",
                    color: exportStatus.ok ? C.green : C.red,
                  }}>{exportStatus.msg}</span>
                )}
              </div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {["Step", "S_prev", "O", "V", "Burn", "S_temp", "L", "Band", "mintRaw", "λ", "Δ", "S_new", "Hash"].map(h => (
                    <th key={h} style={{ padding: "5px 6px", textAlign: "left", color: C.muted, fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.slice(-60).reverse().map(s => (
                  <tr key={s.step} style={{ borderBottom: `1px solid ${C.border}22` }}>
                    <td style={{ padding: "4px 6px", color: C.dim }}>{s.step}</td>
                    <td style={{ padding: "4px 6px" }}>{s.sPrev?.toFixed(1)}</td>
                    <td style={{ padding: "4px 6px", color: C.cyan }}>{s.oi?.toFixed(0)}</td>
                    <td style={{ padding: "4px 6px", color: C.orange }}>{s.vTotal?.toFixed(0)}</td>
                    <td style={{ padding: "4px 6px", color: C.orange }}>{s.burnAmount?.toFixed(4)}</td>
                    <td style={{ padding: "4px 6px", color: C.dim }}>{s.sTemp?.toFixed(1)}</td>
                    <td style={{ padding: "4px 6px", color: s.l < config.bandLow ? C.red : s.l >= config.bandHigh ? C.green : C.gold, fontWeight: 600 }}>
                      {s.l?.toFixed(6)}
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <span style={{
                        padding: "1px 5px", borderRadius: "3px", fontSize: "9px",
                        background: s.band === "BELOW" ? C.red + "22" : s.band === "ABOVE" ? C.green + "22" : C.gold + "22",
                        color: s.band === "BELOW" ? C.red : s.band === "ABOVE" ? C.green : C.gold,
                      }}>{s.band}</span>
                    </td>
                    <td style={{ padding: "4px 6px", color: C.blue }}>{s.mintRaw?.toFixed(1)}</td>
                    <td style={{ padding: "4px 6px", color: C.gold }}>{s.lambda?.toFixed(4)}</td>
                    <td style={{ padding: "4px 6px", color: s.delta > 0 ? C.blue : C.muted, fontWeight: s.delta > 0 ? 600 : 400 }}>
                      {s.delta?.toFixed(2)}
                    </td>
                    <td style={{ padding: "4px 6px", color: C.purple }}>{s.sNew?.toFixed(1)}</td>
                    <td style={{ padding: "4px 6px", color: C.muted, fontSize: "8px" }}>{s.hash?.slice(0, 12)}…</td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr><td colSpan={13} style={{ padding: "20px", textAlign: "center", color: C.muted }}>No steps recorded</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ═══ AUDIT ═══ */}
        {activeTab === "audit" && (
          <div>
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px", marginBottom: "14px" }}>
              <div style={{ fontSize: "11px", color: C.muted, marginBottom: "10px" }}>SHA-256 HASH CHAIN — Section 4.7 Verification</div>
              <div style={{ display: "flex", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
                <button onClick={verifyChain} style={{
                  padding: "7px 16px", fontSize: "12px", fontWeight: 600,
                  background: C.gold, color: C.bg,
                  border: "none", borderRadius: "5px", cursor: "pointer", fontFamily: mono,
                }}>Verify Chain</button>
                {verifyResult && (
                  <div style={{
                    padding: "7px 14px", borderRadius: "5px", fontSize: "12px",
                    background: verifyResult.valid ? C.green + "18" : C.red + "22",
                    color: verifyResult.valid ? C.green : C.red,
                    border: `1px solid ${verifyResult.valid ? C.green + "44" : C.red + "66"}`,
                  }}>
                    {verifyResult.valid ? "✓" : "✗"} {verifyResult.msg}
                  </div>
                )}
              </div>
              <div style={{ maxHeight: "350px", overflow: "auto" }}>
                {hashChain.slice(-40).reverse().map(h => (
                  <div key={h.step} style={{
                    padding: "6px 10px", borderBottom: `1px solid ${C.border}22`,
                    display: "flex", gap: "10px", fontSize: "10px", alignItems: "center",
                  }}>
                    <span style={{ color: C.muted, minWidth: "55px" }}>Step {h.step}</span>
                    <span style={{ color: C.dim, fontFamily: mono, fontSize: "9px", wordBreak: "break-all" }}>{h.hash}</span>
                  </div>
                ))}
                {hashChain.length === 0 && (
                  <div style={{ padding: "20px", textAlign: "center", color: C.muted }}>No audit records</div>
                )}
              </div>
            </div>
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px" }}>
              <div style={{ fontSize: "11px", color: C.muted, marginBottom: "6px" }}>VERIFICATION METHOD</div>
              <div style={{ fontSize: "11px", color: C.dim, lineHeight: 1.7 }}>
                Each step trace is serialised to JSON and chained: hash_t = SHA-256(hash_(t-1) || JSON(trace_t)).
                Modification of any historical record invalidates all subsequent hashes. The algorithm matches
                Section 4.7 of the whitepaper. Note: JS serialisation differs from Go's json.Marshal, so hashes
                are deterministic within this simulator but not byte-identical to the Go reference implementation.
                Verification covers the retained window (last 300 steps), not the full run history beyond that window.
              </div>
            </div>
          </div>
        )}

        {/* ═══ CONFIG ═══ */}
        {activeTab === "config" && (
          <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px" }}>
              <div style={{ fontSize: "11px", color: C.muted, marginBottom: "14px" }}>MECHANISM PARAMETERS</div>
              {[
                { key: "phiTarget", label: "φ (ratio target)", step: 0.001 },
                { key: "bandLow", label: "bL (lower band)", step: 0.005 },
                { key: "bandHigh", label: "bH (upper band)", step: 0.005 },
                { key: "burnBase", label: "B (burn base)", step: 0.0001 },
                { key: "burnVelocityK", label: "k (velocity sensitivity)", step: 0.01 },
              ].map(({ key, label, step }) => (
                <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${C.border}22` }}>
                  <span style={{ fontSize: "11px", color: C.dim }}>{label}</span>
                  <input type="number" value={config[key]} step={step}
                    onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setConfig(prev => ({ ...prev, [key]: v })); }}
                    disabled={isRunning}
                    style={{
                      width: "100px", textAlign: "right", padding: "4px 8px",
                      background: C.surface, color: C.gold, border: `1px solid ${C.border}`,
                      borderRadius: "4px", fontSize: "12px", fontFamily: mono,
                    }} />
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${C.border}22` }}>
                <span style={{ fontSize: "11px", color: C.dim }}>M (max capacity)</span>
                <input type="number" value={mcap} min={100} step={10000}
                  onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setMcap(v); }}
                  disabled={isRunning}
                  style={{ width: "120px", textAlign: "right", padding: "4px 8px", background: C.surface, color: C.gold, border: `1px solid ${C.border}`, borderRadius: "4px", fontSize: "12px", fontFamily: mono }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${C.border}22` }}>
                <span style={{ fontSize: "11px", color: C.dim }}>S₀ (% of M)</span>
                <input type="number" value={s0Pct} min={0.01} max={100} step={1}
                  onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0 && v <= 100) setS0Pct(v); }}
                  disabled={isRunning}
                  style={{ width: "80px", textAlign: "right", padding: "4px 8px", background: C.surface, color: C.gold, border: `1px solid ${C.border}`, borderRadius: "4px", fontSize: "12px", fontFamily: mono }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0" }}>
                <span style={{ fontSize: "11px", color: C.dim }}>Seed (PRNG)</span>
                <input type="number" value={seed}
                  onChange={e => setSeed(parseInt(e.target.value) || 0)}
                  disabled={isRunning}
                  style={{ width: "80px", textAlign: "right", padding: "4px 8px", background: C.surface, color: C.gold, border: `1px solid ${C.border}`, borderRadius: "4px", fontSize: "12px", fontFamily: mono }} />
              </div>

              {profile === "custom" && (
                <div style={{ marginTop: "12px", borderTop: `1px solid ${C.border}`, paddingTop: "12px" }}>
                  <div style={{ fontSize: "11px", color: C.muted, marginBottom: "8px" }}>CUSTOM TELEMETRY</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0" }}>
                    <span style={{ fontSize: "11px", color: C.dim }}>O (obligation)</span>
                    <input type="number" value={customO} min={0} step={10000}
                      onChange={e => setCustomO(Math.max(0, Number(e.target.value)))}
                      style={{ width: "120px", textAlign: "right", padding: "4px 8px", background: C.surface, color: C.cyan, border: `1px solid ${C.border}`, borderRadius: "4px", fontSize: "12px", fontFamily: mono }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0" }}>
                    <span style={{ fontSize: "11px", color: C.dim }}>V (activity)</span>
                    <input type="number" value={customV} min={0} step={1000}
                      onChange={e => setCustomV(Math.max(0, Number(e.target.value)))}
                      style={{ width: "120px", textAlign: "right", padding: "4px 8px", background: C.surface, color: C.orange, border: `1px solid ${C.border}`, borderRadius: "4px", fontSize: "12px", fontFamily: mono }} />
                  </div>
                </div>
              )}

              {profile === "regimeSequence" && (
                <div style={{ marginTop: "12px", borderTop: `1px solid ${C.border}`, paddingTop: "12px" }}>
                  <div style={{ fontSize: "11px", color: C.muted, marginBottom: "8px" }}>REGIME SEQUENCE</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", marginBottom: "8px" }}>
                    <span style={{ fontSize: "11px", color: C.dim }}>Preset</span>
                    <select value={regimePreset} onChange={e => setRegimePreset(e.target.value)} disabled={isRunning}
                      style={{ background: C.surface, color: C.gold, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "4px 8px", fontSize: "11px", fontFamily: mono, maxWidth: "220px" }}>
                      {Object.entries(REGIME_PRESETS).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ fontSize: "10px", color: C.dim, marginBottom: "10px", lineHeight: 1.5 }}>
                    {REGIME_PRESETS[regimePreset]?.desc}
                  </div>
                  {currentRegimeLabel && isRunning && (
                    <div style={{ padding: "6px 10px", background: C.gold + "18", border: `1px solid ${C.gold}44`, borderRadius: "4px", fontSize: "11px", color: C.gold, fontWeight: 600, marginBottom: "10px" }}>
                      ACTIVE REGIME: {currentRegimeLabel}
                    </div>
                  )}
                  <div style={{ fontSize: "10px", color: C.muted, marginBottom: "6px" }}>
                    SCHEDULE ({regimeBlocks.reduce((s, b) => s + b.steps, 0)} total steps)
                  </div>
                  <div style={{ maxHeight: "260px", overflow: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px" }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                          {["#", "Label", "O", "V", "Steps", "Burst%", "Scale"].map(h => (
                            <th key={h} style={{ padding: "4px 5px", textAlign: "left", color: C.muted, fontWeight: 500 }}>{h}</th>
                          ))}
                          {regimePreset === "customRegime" && !isRunning && <th style={{ padding: "4px 5px", color: C.muted }}>Del</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {regimeBlocks.map((block, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${C.border}22` }}>
                            <td style={{ padding: "3px 5px", color: C.dim }}>{i + 1}</td>
                            {regimePreset === "customRegime" && !isRunning ? (
                              <>
                                <td style={{ padding: "3px 2px" }}>
                                  <input value={block.label} onChange={e => {
                                    const nb = [...regimeBlocks]; nb[i] = { ...nb[i], label: e.target.value }; setRegimeBlocks(nb);
                                  }} style={{ width: "70px", background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: "3px", padding: "2px 4px", fontSize: "10px", fontFamily: mono }} />
                                </td>
                                <td style={{ padding: "3px 2px" }}>
                                  <input type="number" value={block.O} onChange={e => {
                                    const nb = [...regimeBlocks]; nb[i] = { ...nb[i], O: Math.max(0, Number(e.target.value)) }; setRegimeBlocks(nb);
                                  }} style={{ width: "70px", background: C.surface, color: C.cyan, border: `1px solid ${C.border}`, borderRadius: "3px", padding: "2px 4px", fontSize: "10px", fontFamily: mono }} />
                                </td>
                                <td style={{ padding: "3px 2px" }}>
                                  <input type="number" value={block.V} onChange={e => {
                                    const nb = [...regimeBlocks]; nb[i] = { ...nb[i], V: Math.max(0, Number(e.target.value)) }; setRegimeBlocks(nb);
                                  }} style={{ width: "65px", background: C.surface, color: C.orange, border: `1px solid ${C.border}`, borderRadius: "3px", padding: "2px 4px", fontSize: "10px", fontFamily: mono }} />
                                </td>
                                <td style={{ padding: "3px 2px" }}>
                                  <input type="number" value={block.steps} min={1} onChange={e => {
                                    const nb = [...regimeBlocks]; nb[i] = { ...nb[i], steps: Math.max(1, parseInt(e.target.value) || 1) }; setRegimeBlocks(nb);
                                  }} style={{ width: "50px", background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: "3px", padding: "2px 4px", fontSize: "10px", fontFamily: mono }} />
                                </td>
                                <td style={{ padding: "3px 2px" }}>
                                  <input type="number" value={block.burstChance} min={0} max={1} step={0.05} onChange={e => {
                                    const nb = [...regimeBlocks]; nb[i] = { ...nb[i], burstChance: Math.max(0, Math.min(1, Number(e.target.value))) }; setRegimeBlocks(nb);
                                  }} style={{ width: "45px", background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: "3px", padding: "2px 4px", fontSize: "10px", fontFamily: mono }} />
                                </td>
                                <td style={{ padding: "3px 2px" }}>
                                  <input type="number" value={block.burstScale} min={1} step={0.1} onChange={e => {
                                    const nb = [...regimeBlocks]; nb[i] = { ...nb[i], burstScale: Math.max(1, Number(e.target.value)) }; setRegimeBlocks(nb);
                                  }} style={{ width: "45px", background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: "3px", padding: "2px 4px", fontSize: "10px", fontFamily: mono }} />
                                </td>
                                <td style={{ padding: "3px 2px" }}>
                                  <button onClick={() => { if (regimeBlocks.length > 1) setRegimeBlocks(regimeBlocks.filter((_, j) => j !== i)); }}
                                    style={{ background: "transparent", color: C.red, border: "none", cursor: "pointer", fontSize: "12px", fontFamily: mono }}>x</button>
                                </td>
                              </>
                            ) : (
                              <>
                                <td style={{ padding: "3px 5px", color: C.text }}>{block.label}</td>
                                <td style={{ padding: "3px 5px", color: C.cyan }}>{(block.O / 1000).toFixed(0)}k</td>
                                <td style={{ padding: "3px 5px", color: C.orange }}>{(block.V / 1000).toFixed(0)}k</td>
                                <td style={{ padding: "3px 5px" }}>{block.steps}</td>
                                <td style={{ padding: "3px 5px" }}>{(block.burstChance * 100).toFixed(0)}%</td>
                                <td style={{ padding: "3px 5px" }}>{block.burstScale}x</td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {regimePreset === "customRegime" && !isRunning && (
                    <button onClick={() => setRegimeBlocks([...regimeBlocks, { label: "Phase " + (regimeBlocks.length + 1), O: 1_000_000, V: 50_000, steps: 100, burstChance: 0.1, burstScale: 1.3 }])}
                      style={{ marginTop: "6px", padding: "4px 10px", fontSize: "10px", background: C.surface, color: C.green, border: `1px solid ${C.green}44`, borderRadius: "4px", cursor: "pointer", fontFamily: mono }}>
                      + Add Block
                    </button>
                  )}
                </div>
              )}

              {configError && (
                <div style={{ marginTop: "12px", padding: "8px 10px", background: C.red + "18", color: C.red, borderRadius: "5px", fontSize: "11px" }}>
                  ⚠ {configError}
                </div>
              )}
            </div>

            <div style={{ flex: "1 1 320px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px" }}>
              <div style={{ fontSize: "11px", color: C.muted, marginBottom: "14px" }}>FORMAL GUARANTEES (Whitepaper Section 5)</div>
              <div style={{ fontSize: "11px", color: C.dim, lineHeight: 2.2 }}>
                <div>1. Non-negativity: S ≥ 0 <span style={{ color: supply >= 0 ? C.green : C.red }}>{supply >= 0 ? "✓" : "✗"}</span></div>
                <div>2. Capacity bound: S ≤ M <span style={{ color: supply <= mcap ? C.green : C.red }}>{supply <= mcap ? "✓" : "✗"}</span></div>
                <div>3. Conditional mint: Δ {">"} 0 only if L {"<"} bL <span style={{ color: C.green }}>✓</span></div>
                <div>4. Progressive resistance: λ = φ^(S/M) decreasing <span style={{ color: C.green }}>✓</span></div>
                <div>5. Deterministic audit: SHA-256 chain <span style={{ color: C.green }}>✓</span></div>
              </div>
              <div style={{ marginTop: "10px", fontSize: "10px", color: C.muted, lineHeight: 1.6, padding: "8px", background: C.surface, borderRadius: "4px" }}>
                Band convention (half-open): BELOW if L {"<"} bL, IN BAND if bL ≤ L {"<"} bH, ABOVE if L ≥ bH.
                Minting triggers only in BELOW state. Consistent with whitepaper §4.4–4.5.
              </div>

              <div style={{ marginTop: "16px", borderTop: `1px solid ${C.border}`, paddingTop: "12px" }}>
                <div style={{ fontSize: "11px", color: C.muted, marginBottom: "8px" }}>SYSTEM STATE</div>
                <div style={{ fontSize: "11px", color: C.dim, lineHeight: 2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>Supply (S):</span><span style={{ color: C.purple }}>{supply.toFixed(2)}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>Capacity (M):</span><span>{mcap.toLocaleString()}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>S/M:</span><span>{(supply / mcap * 100).toFixed(3)}%</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>λ (current):</span><span style={{ color: C.gold }}>{currentLambda.toFixed(8)}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>Steps:</span><span>{stepNum}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>Profile:</span><span style={{ color: C.gold }}>{TELEMETRY_PROFILES[profile].label}</span></div>
                </div>
              </div>

              <div style={{ marginTop: "16px", borderTop: `1px solid ${C.border}`, paddingTop: "12px" }}>
                <div style={{ fontSize: "11px", color: C.muted, marginBottom: "8px" }}>ACCOUNTING RECONCILIATION</div>
                <div style={{ fontSize: "11px", color: C.dim, lineHeight: 2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>S₀:</span><span>{s0.toFixed(2)}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>Total burned:</span><span style={{ color: C.orange }}>−{ledger.totalBurned.toFixed(4)}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>Total minted:</span><span style={{ color: C.blue }}>+{ledger.totalMinted.toFixed(4)}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${C.border}`, paddingTop: "4px", marginTop: "4px" }}>
                    <span>Expected S:</span><span>{expectedS.toFixed(4)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Actual S:</span><span style={{ color: C.purple }}>{supply.toFixed(4)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Drift:</span>
                    <span style={{ color: accountingOk ? C.green : C.red, fontWeight: 600 }}>
                      {accountingDrift.toFixed(8)} {accountingOk ? "✓" : "✗"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── FOOTER ───────────────────────────────────────────────── */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: "14px 24px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
        <span style={{ fontSize: "10px", color: C.muted }}>© Valraj Singh Mann — Mann Mechanics — UKIPO GB2513172.3</span>
        <span style={{ fontSize: "10px", color: C.muted }}>Reference simulator only — Not production software — Not financial advice</span>
      </div>
    </div>
  );
}
