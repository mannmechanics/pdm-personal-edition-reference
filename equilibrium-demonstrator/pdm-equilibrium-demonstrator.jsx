import { useState, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, ReferenceLine, CartesianGrid,
  Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell,
} from "recharts";

// ═══════════════════════════════════════════════════════════════════════
// PDM Equilibrium Demonstrator
// Personal Edition — Mann Mechanics
//
// Control law: IDENTICAL to pdm-personal/main.go v1.0.1
// Purpose: Show institutional audiences what PDM does, not how to test it.
// ═══════════════════════════════════════════════════════════════════════

// ─── Seeded PRNG (Mulberry32) ─────────────────────────────────────────
function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── SHA-256 ──────────────────────────────────────────────────────────
function sha256Fallback(msg) {
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

// ═══════════════════════════════════════════════════════════════════════
// StepPDM — IDENTICAL to pdm-personal/main.go v1.0.1
// ═══════════════════════════════════════════════════════════════════════
const PDM_CONFIG = {
  phiTarget: 0.618,
  bandLow: 0.60,
  bandHigh: 0.62,
  burnBase: 0.000618,
  burnVelocityK: 0.1,
};
const MCAP = 1_000_000;

function stepPDM(sPrev, oi, vtotal, mcap, cfg) {
  const minS = 1e-9 * mcap;
  const minO = 1e-6;

  const effectiveOi = Math.max(oi, minO);
  const sSafe = Math.max(sPrev, minS);

  const velocity = vtotal / sSafe;
  const deviation = velocity - cfg.phiTarget;

  let burnRate = 1.0 - cfg.burnVelocityK * deviation;
  if (burnRate < 0) burnRate = 0;
  const burnAmount = cfg.burnBase * burnRate * vtotal;
  let sTemp = sPrev - burnAmount;
  let clampedS = false;
  if (sTemp < 0) { clampedS = true; sTemp = 0; }

  const l = sTemp / effectiveOi;

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
// SECTOR CONTEXTS — relabelling only, maths unchanged
// ═══════════════════════════════════════════════════════════════════════
const SECTORS = {
  abstract:   { label: "Abstract",          supply: "Supply",         demand: "Demand",         activity: "Activity",      unit: "units" },
  monetary:   { label: "Money Creation",    supply: "Money Supply",   demand: "Credit Demand",  activity: "Settlements",   unit: "units" },
  energy:     { label: "Energy Grid",       supply: "MW Capacity",    demand: "Grid Demand",    activity: "Delivered",     unit: "MW" },
  carbon:     { label: "Carbon Credits",    supply: "Credits",        demand: "Obligations",    activity: "Retired",       unit: "credits" },
  bandwidth:  { label: "Bandwidth",         supply: "Capacity",       demand: "Traffic Demand", activity: "Throughput",    unit: "Mbps" },
  telecoms:   { label: "Telecoms",          supply: "Network Capacity", demand: "Connection Demand", activity: "Calls Routed", unit: "channels" },
  ai_compute: { label: "AI / Compute",      supply: "Compute Credits", demand: "Job Queue",     activity: "Jobs Processed", unit: "credits" },
};

// ═══════════════════════════════════════════════════════════════════════
// TELEMETRY — Variable demand that shows the full PDM cycle
// ═══════════════════════════════════════════════════════════════════════
function generateTelemetry(step, rng) {
  // Phase design: the viewer sees equilibrium, then demand rises,
  // L drifts down, minting fires, system recovers, demand eases,
  // burn takes over, cycle repeats. This is the PDM story.
  const cycle = step % 120;
  let O, V;
  if (cycle < 40) {
    // Equilibrium phase: steady demand, gentle burn
    O = 1_000_000 + rng() * 20_000;
    V = 50_000 + rng() * 10_000;
  } else if (cycle < 60) {
    // Rising demand: O climbs, V increases
    const ramp = (cycle - 40) / 20;
    O = 1_000_000 + ramp * 400_000 + rng() * 30_000;
    V = 55_000 + ramp * 25_000 + rng() * 8_000;
  } else if (cycle < 80) {
    // High demand plateau: minting should fire
    O = 1_400_000 + rng() * 50_000;
    V = 75_000 + rng() * 15_000;
  } else if (cycle < 100) {
    // Demand easing: O drops back
    const ramp = (cycle - 80) / 20;
    O = 1_400_000 - ramp * 400_000 + rng() * 30_000;
    V = 70_000 - ramp * 20_000 + rng() * 10_000;
  } else {
    // Low demand: burn dominates, supply contracts
    O = 950_000 + rng() * 50_000;
    V = 45_000 + rng() * 12_000;
  }
  return { O, V };
}

// ═══════════════════════════════════════════════════════════════════════
// STYLING — Bloomberg terminal meets BIS publication
// ═══════════════════════════════════════════════════════════════════════
const C = {
  bg: "#ffffff",
  surface: "#f7f8fa",
  panel: "#f0f1f4",
  panelHover: "#e8eaee",
  border: "#d8dbe2",
  borderHi: "#c0c5cf",
  text: "#1a1d23",
  dim: "#5a6070",
  muted: "#8e95a3",
  gold: "#8a6d1b",
  goldDim: "#b09444",
  goldGlow: "#8a6d1b18",
  red: "#c0392b",
  green: "#1a8a3a",
  blue: "#2266aa",
  purple: "#6a3ea0",
  orange: "#b06a10",
  cyan: "#1a7a70",
  mint: "#2aa868",
  grid: "#e8eaee",
  bandFill: "#8a6d1b06",
};

const mono = "'JetBrains Mono', 'SF Mono', 'Consolas', 'Fira Code', monospace";
const display = "'Georgia', 'Times New Roman', serif";

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════
export default function PDMDemonstrator() {
  const [sector, setSector] = useState("abstract");
  const [isRunning, setIsRunning] = useState(false);
  const [history, setHistory] = useState([]);
  const [supply, setSupply] = useState(MCAP * 0.618);
  const [stepNum, setStepNum] = useState(0);
  const [ledger, setLedger] = useState({ totalBurned: 0, totalMinted: 0, mintEvents: 0 });
  const [hashChain, setHashChain] = useState([]);
  const [verifyResult, setVerifyResult] = useState(null);
  const [activeView, setActiveView] = useState("dashboard");

  // Refs — authoritative for async tick
  const supplyRef = useRef(MCAP * 0.618);
  const prevHashRef = useRef("");
  const stepNumRef = useRef(0);
  const historyRef = useRef([]);
  const hashChainRef = useRef([]);
  const ledgerRef = useRef({ totalBurned: 0, totalMinted: 0, mintEvents: 0 });
  const prngRef = useRef(mulberry32(42));
  const isRunningRef = useRef(false);
  const runIdRef = useRef(0);
  const tickBusy = useRef(false);

  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);

  const s0 = MCAP * 0.618;

  const reset = useCallback(() => {
    setIsRunning(false);
    runIdRef.current += 1;
    tickBusy.current = false;
    supplyRef.current = s0;
    prevHashRef.current = "";
    stepNumRef.current = 0;
    historyRef.current = [];
    hashChainRef.current = [];
    ledgerRef.current = { totalBurned: 0, totalMinted: 0, mintEvents: 0 };
    prngRef.current = mulberry32(42);
    setSupply(s0);
    setStepNum(0);
    setHistory([]);
    setHashChain([]);
    setLedger({ totalBurned: 0, totalMinted: 0, mintEvents: 0 });
    setVerifyResult(null);
  }, [s0]);

  useEffect(() => { reset(); }, [reset]);

  // ─── Tick ───────────────────────────────────────────────────────
  const tick = useCallback(async () => {
    if (tickBusy.current) return;
    tickBusy.current = true;
    const localRunId = runIdRef.current;

    try {
      const currentS = supplyRef.current;
      const step = stepNumRef.current + 1;
      const rng = prngRef.current;

      const { O, V } = generateTelemetry(step, rng);
      const { sNew, trace } = stepPDM(currentS, O, V, MCAP, PDM_CONFIG);

      const traceForHash = { step, ...trace };
      const traceJSON = JSON.stringify(traceForHash);
      const currentPrev = prevHashRef.current;
      const newHash = await sha256(currentPrev + traceJSON);

      if (runIdRef.current !== localRunId) return;

      const traceRecord = { step, ...trace, _hashBody: traceJSON, prevHash: currentPrev, hash: newHash };
      const hashRecord = { step, hash: newHash, prevHash: currentPrev };

      supplyRef.current = sNew;
      prevHashRef.current = newHash;
      stepNumRef.current = step;

      const prevLedger = ledgerRef.current;
      const newLedger = {
        totalBurned: prevLedger.totalBurned + trace.burnAmount,
        totalMinted: prevLedger.totalMinted + trace.delta,
        mintEvents: prevLedger.mintEvents + (trace.delta > 0 ? 1 : 0),
      };
      ledgerRef.current = newLedger;

      let nextHistory = [...historyRef.current, traceRecord];
      let nextChain = [...hashChainRef.current, hashRecord];
      if (nextHistory.length > 300) {
        nextHistory = nextHistory.slice(-300);
        nextChain = nextChain.slice(-300);
      }
      historyRef.current = nextHistory;
      hashChainRef.current = nextChain;

      setSupply(sNew);
      setStepNum(step);
      setHistory(nextHistory);
      setHashChain(nextChain);
      setLedger(newLedger);
    } finally {
      tickBusy.current = false;
    }
  }, []);

  // ─── Auto-run ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isRunning) return;
    let timeoutId = null;
    let cancelled = false;
    const schedule = async () => {
      if (cancelled) return;
      const before = runIdRef.current;
      await tick();
      if (cancelled || !isRunningRef.current || runIdRef.current !== before) return;
      timeoutId = setTimeout(schedule, 420);
    };
    timeoutId = setTimeout(schedule, 420);
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [isRunning, tick]);

  // ─── Hash chain verify ──────────────────────────────────────────
  const verifyChain = useCallback(async () => {
    const h = historyRef.current;
    if (h.length === 0) { setVerifyResult({ valid: false, msg: "No steps to verify." }); return; }
    let valid = true;
    let failMsg = "";
    let expectedPrev = "";
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

  // ─── Derived ────────────────────────────────────────────────────
  const lastTrace = history.length > 0 ? history[history.length - 1] : null;
  const currentL = lastTrace ? lastTrace.l : s0 / 1_000_000;
  const currentLambda = lastTrace ? lastTrace.lambda : Math.pow(PDM_CONFIG.phiTarget, supply / MCAP);
  const bandStatus = lastTrace === null ? "STABLE" : lastTrace.l < PDM_CONFIG.bandLow ? "BELOW" : lastTrace.l >= PDM_CONFIG.bandHigh ? "ABOVE" : "STABLE";

  const expectedS = s0 - ledger.totalBurned + ledger.totalMinted;
  const accountingDrift = Math.abs(supply - expectedS);
  const accountingOk = accountingDrift < 0.01;

  const ctx = SECTORS[sector];

  const ttStyle = {
    background: C.surface,
    border: `1px solid ${C.borderHi}`,
    borderRadius: "4px",
    fontSize: "11px",
    fontFamily: mono,
    color: C.text,
    padding: "8px 10px",
  };

  const fmt = (n) => {
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
    if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "k";
    return n.toFixed(1);
  };

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  return (
    <div style={{
      background: C.bg, color: C.text, minHeight: "100vh",
      fontFamily: mono, fontSize: "13px",
    }}>
      {/* ─── HEADER ───────────────────────────────────────────── */}
      <div style={{
        borderBottom: `1px solid ${C.border}`,
        padding: "20px 28px 16px",
        background: `linear-gradient(180deg, ${C.surface} 0%, ${C.bg} 100%)`,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
              <span style={{
                fontSize: "20px", fontWeight: 700, color: C.gold,
                letterSpacing: "0.06em", fontFamily: display,
              }}>
                Progressive Depletion Minting
              </span>
              <span style={{ fontSize: "11px", color: C.muted, letterSpacing: "0.04em" }}>EQUILIBRIUM DEMONSTRATOR</span>
            </div>
            <div style={{
              fontSize: "11px", color: C.dim, marginTop: "6px", lineHeight: 1.6,
              maxWidth: "640px",
            }}>
              A deterministic control mechanism that regulates expansion and contraction of bounded resources
              through measurable conditions, not human discretion.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{
              padding: "5px 12px", borderRadius: "4px", fontSize: "10px",
              background: accountingOk ? C.green + "14" : C.red + "22",
              color: accountingOk ? C.green : C.red,
              border: `1px solid ${accountingOk ? C.green + "33" : C.red + "55"}`,
              fontWeight: 600, letterSpacing: "0.06em",
            }}>
              LEDGER {accountingOk ? "BALANCED" : `DRIFT ${accountingDrift.toFixed(4)}`}
            </div>
            <div style={{
              width: "10px", height: "10px", borderRadius: "50%",
              background: isRunning ? C.green : C.muted,
              boxShadow: isRunning ? `0 0 12px ${C.green}88` : "none",
              transition: "all 0.3s",
            }} />
          </div>
        </div>
      </div>

      {/* ─── CONTROLS BAR ─────────────────────────────────────── */}
      <div style={{
        borderBottom: `1px solid ${C.border}`,
        padding: "10px 28px",
        display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap",
        background: C.surface + "60",
      }}>
        <button
          onClick={() => setIsRunning(!isRunning)}
          style={{
            padding: "8px 22px", fontSize: "12px", fontWeight: 600,
            background: isRunning ? C.red : C.gold,
            color: isRunning ? "#fff" : "#fff",
            border: "none", borderRadius: "4px", cursor: "pointer",
            fontFamily: mono, letterSpacing: "0.04em",
            boxShadow: isRunning ? `0 0 16px ${C.red}44` : `0 0 16px ${C.goldGlow}`,
            transition: "all 0.2s",
          }}
        >
          {isRunning ? "STOP" : "OBSERVE"}
        </button>

        <button
          onClick={reset}
          disabled={isRunning}
          style={{
            padding: "8px 16px", fontSize: "11px",
            background: "transparent", color: isRunning ? C.muted : C.dim,
            border: `1px solid ${isRunning ? C.muted + "44" : C.border}`,
            borderRadius: "4px", cursor: isRunning ? "not-allowed" : "pointer",
            fontFamily: mono,
          }}
        >
          RESET
        </button>

        <div style={{ width: "1px", height: "24px", background: C.border, margin: "0 6px" }} />

        <div style={{ fontSize: "11px", color: C.dim, display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ letterSpacing: "0.04em" }}>CONTEXT</span>
          <select
            value={sector}
            onChange={e => setSector(e.target.value)}
            style={{
              background: C.panel, color: C.gold, border: `1px solid ${C.border}`,
              borderRadius: "4px", padding: "5px 10px", fontSize: "11px",
              fontFamily: mono, cursor: "pointer",
            }}
          >
            {Object.entries(SECTORS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: "16px", alignItems: "center" }}>
          {["dashboard", "audit"].map(v => (
            <button
              key={v}
              onClick={() => setActiveView(v)}
              style={{
                padding: "5px 12px", fontSize: "10px",
                background: activeView === v ? C.gold + "18" : "transparent",
                color: activeView === v ? C.gold : C.dim,
                border: `1px solid ${activeView === v ? C.gold + "44" : "transparent"}`,
                borderRadius: "4px", cursor: "pointer", fontFamily: mono,
                letterSpacing: "0.06em", fontWeight: activeView === v ? 600 : 400,
              }}
            >
              {v === "dashboard" ? "DASHBOARD" : "AUDIT CHAIN"}
            </button>
          ))}
          <span style={{ fontSize: "11px", color: C.muted, fontFamily: mono }}>
            STEP {stepNum}
          </span>
        </div>
      </div>

      {/* ─── MAIN CONTENT ─────────────────────────────────────── */}
      <div style={{ padding: "20px 28px" }}>

        {activeView === "dashboard" && (
          <>
            {/* ─── KEY METRICS ─────────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: "10px", marginBottom: "20px" }}>
              {[
                {
                  label: ctx.supply, value: fmt(supply),
                  sub: `${(supply / MCAP * 100).toFixed(1)}% of ceiling`,
                  color: C.purple,
                },
                {
                  label: "L RATIO", value: currentL.toFixed(4),
                  sub: bandStatus === "BELOW" ? "Below band" : bandStatus === "ABOVE" ? "Above band" : "In stability band",
                  color: bandStatus === "BELOW" ? C.red : bandStatus === "ABOVE" ? C.cyan : C.gold,
                },
                {
                  label: "RESISTANCE (λ)", value: (currentLambda * 100).toFixed(1) + "%",
                  sub: `${((1 - currentLambda) * 100).toFixed(1)}% suppressed`,
                  color: C.gold,
                },
                {
                  label: "TOTAL CONTRACTED", value: fmt(ledger.totalBurned),
                  sub: "Cumulative burn",
                  color: C.orange,
                },
                {
                  label: "TOTAL EXPANDED", value: fmt(ledger.totalMinted),
                  sub: `${ledger.mintEvents} events`,
                  color: C.blue,
                },
                {
                  label: "NET CHANGE", value: fmt(ledger.totalMinted - ledger.totalBurned),
                  sub: `From ${fmt(s0)}`,
                  color: (ledger.totalMinted - ledger.totalBurned) >= 0 ? C.green : C.red,
                },
              ].map((m, i) => (
                <div key={i} style={{
                  background: C.panel, border: `1px solid ${C.border}`,
                  borderRadius: "5px", padding: "14px 16px",
                  borderTop: `2px solid ${m.color}22`,
                }}>
                  <div style={{ fontSize: "9px", color: C.muted, letterSpacing: "0.1em", marginBottom: "6px" }}>{m.label}</div>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: m.color, lineHeight: 1.1 }}>{m.value}</div>
                  <div style={{ fontSize: "10px", color: C.dim, marginTop: "4px" }}>{m.sub}</div>
                </div>
              ))}
            </div>

            {/* ─── ACCOUNTING IDENTITY ─────────────────────────── */}
            <div style={{
              background: C.panel, border: `1px solid ${accountingOk ? C.green + "22" : C.red + "44"}`,
              borderRadius: "5px", padding: "10px 16px", marginBottom: "20px",
              display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap",
              fontSize: "11px", color: C.dim,
            }}>
              <span style={{ color: C.gold, fontWeight: 600, letterSpacing: "0.06em", marginRight: "8px" }}>ACCOUNTING IDENTITY</span>
              <span>S₀ ({fmt(s0)})</span>
              <span style={{ color: C.orange }}>- burned ({fmt(ledger.totalBurned)})</span>
              <span style={{ color: C.blue }}>+ minted ({fmt(ledger.totalMinted)})</span>
              <span>= {fmt(expectedS)}</span>
              <span style={{ margin: "0 4px", color: C.muted }}>|</span>
              <span>Actual = <span style={{ color: C.purple }}>{fmt(supply)}</span></span>
              <span style={{ color: accountingOk ? C.green : C.red, fontWeight: 600, marginLeft: "4px" }}>
                {accountingOk ? "Balanced" : `Drift: ${accountingDrift.toFixed(6)}`}
              </span>
            </div>

            {/* ─── L RATIO CHART (PRIMARY) ─────────────────────── */}
            <div style={{
              background: C.panel, border: `1px solid ${C.border}`,
              borderRadius: "5px", padding: "16px 18px", marginBottom: "14px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
                <span style={{ fontSize: "10px", color: C.muted, letterSpacing: "0.08em" }}>
                  {ctx.supply}-TO-{ctx.demand} RATIO
                </span>
                <span style={{ fontSize: "10px", color: C.dim }}>
                  Stability band [{PDM_CONFIG.bandLow}, {PDM_CONFIG.bandHigh}] | Target: φ = 0.618
                </span>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={history.slice(-120)} margin={{ top: 8, right: 24, left: 0, bottom: 5 }}>
                  <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="step" tick={{ fill: C.muted, fontSize: 9 }} />
                  <YAxis
                    tick={{ fill: C.muted, fontSize: 9 }}
                    domain={[
                      (dataMin) => Math.max(0, Math.min(dataMin, PDM_CONFIG.bandLow) - 0.03),
                      (dataMax) => Math.max(dataMax, PDM_CONFIG.bandHigh) + 0.03,
                    ]}
                  />
                  <ReferenceLine y={PDM_CONFIG.phiTarget} stroke={C.gold} strokeWidth={2} strokeOpacity={0.8}
                    label={{ value: "φ 0.618", fill: C.gold, fontSize: 10, position: "right" }} />
                  <ReferenceLine y={PDM_CONFIG.bandLow} stroke={C.red} strokeDasharray="6 4" strokeWidth={1} strokeOpacity={0.5} />
                  <ReferenceLine y={PDM_CONFIG.bandHigh} stroke={C.green} strokeDasharray="6 4" strokeWidth={1} strokeOpacity={0.5} />
                  <Line type="monotone" dataKey="l" stroke={C.cyan} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                  <Tooltip contentStyle={ttStyle} formatter={(v) => [v?.toFixed(6), "L Ratio"]} labelFormatter={l => `Step ${l}`} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* ─── DUAL CHARTS: Supply + Mint/Burn ─────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
              {/* Supply trajectory */}
              <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "5px", padding: "14px 16px", minWidth: 0 }}>
                <div style={{ fontSize: "10px", color: C.muted, letterSpacing: "0.08em", marginBottom: "6px" }}>
                  {ctx.supply.toUpperCase()} TRAJECTORY
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={history.slice(-120)} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                    <XAxis dataKey="step" tick={{ fill: C.muted, fontSize: 9 }} />
                    <YAxis tick={{ fill: C.muted, fontSize: 9 }} domain={[
                      (dataMin) => Math.max(0, dataMin - MCAP * 0.05),
                      (dataMax) => Math.min(MCAP, dataMax + MCAP * 0.05),
                    ]} tickFormatter={v => fmt(v)} />
                    <ReferenceLine y={MCAP} stroke={C.red} strokeDasharray="8 4" strokeWidth={1} strokeOpacity={0.4}
                      label={{ value: "Ceiling (M)", fill: C.red, fontSize: 9, position: "right" }} />
                    <Area type="monotone" dataKey="sNew" stroke={C.purple} fill={C.purple} fillOpacity={0.08} strokeWidth={2} isAnimationActive={false} />
                    <Tooltip contentStyle={ttStyle} formatter={(v) => [fmt(v), ctx.supply]} labelFormatter={l => `Step ${l}`} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Mint vs Burn asymmetry */}
              <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "5px", padding: "14px 16px", minWidth: 0 }}>
                <div style={{ fontSize: "10px", color: C.muted, letterSpacing: "0.08em", marginBottom: "6px" }}>
                  EXPANSION vs CONTRACTION PER STEP
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={history.slice(-80)} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                    <XAxis dataKey="step" tick={{ fill: C.muted, fontSize: 9 }} />
                    <YAxis tick={{ fill: C.muted, fontSize: 9 }} tickFormatter={v => fmt(v)} />
                    <Bar dataKey="delta" name="Expansion" isAnimationActive={false}>
                      {history.slice(-80).map((e, i) => <Cell key={i} fill={e.delta > 0 ? C.blue : "transparent"} />)}
                    </Bar>
                    <Bar dataKey="burnAmount" name="Contraction" isAnimationActive={false}>
                      {history.slice(-80).map((e, i) => <Cell key={i} fill={C.orange} fillOpacity={0.65} />)}
                    </Bar>
                    <Tooltip contentStyle={ttStyle} formatter={(v) => [fmt(v)]} labelFormatter={l => `Step ${l}`} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ─── DUAL CHARTS: Lambda + Telemetry ─────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
              {/* Progressive resistance */}
              <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "5px", padding: "14px 16px", minWidth: 0 }}>
                <div style={{ fontSize: "10px", color: C.muted, letterSpacing: "0.08em", marginBottom: "6px" }}>
                  PROGRESSIVE RESISTANCE | λ = φ^(S/M)
                </div>
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={history.slice(-120)} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                    <XAxis dataKey="step" tick={{ fill: C.muted, fontSize: 9 }} />
                    <YAxis domain={[0, 1]} tick={{ fill: C.muted, fontSize: 9 }} />
                    <Line type="monotone" dataKey="lambda" stroke={C.gold} strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Tooltip contentStyle={ttStyle} formatter={(v) => [v?.toFixed(6), "λ"]} labelFormatter={l => `Step ${l}`} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Telemetry inputs */}
              <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "5px", padding: "14px 16px", minWidth: 0 }}>
                <div style={{ fontSize: "10px", color: C.muted, letterSpacing: "0.08em", marginBottom: "6px" }}>
                  TELEMETRY | {ctx.demand} (O) and {ctx.activity} (V)
                </div>
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={history.slice(-120)} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                    <XAxis dataKey="step" tick={{ fill: C.muted, fontSize: 9 }} />
                    <YAxis tick={{ fill: C.muted, fontSize: 9 }} tickFormatter={v => fmt(v)} />
                    <Line type="monotone" dataKey="oi" stroke={C.cyan} strokeWidth={1.5} dot={false} isAnimationActive={false} name={ctx.demand} />
                    <Line type="monotone" dataKey="vTotal" stroke={C.orange} strokeWidth={1.5} dot={false} isAnimationActive={false} name={ctx.activity} />
                    <Tooltip contentStyle={ttStyle} formatter={(v) => [fmt(v)]} labelFormatter={l => `Step ${l}`} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ─── MECHANISM NARRATIVE ──────────────────────────── */}
            <div style={{
              background: C.panel, border: `1px solid ${C.border}`,
              borderRadius: "5px", padding: "16px 20px",
              display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px",
            }}>
              <div>
                <div style={{ fontSize: "10px", color: C.orange, letterSpacing: "0.08em", fontWeight: 600, marginBottom: "6px" }}>
                  CONTRACTION
                </div>
                <div style={{ fontSize: "11px", color: C.dim, lineHeight: 1.7 }}>
                  Continuous. Proportional to {ctx.activity.toLowerCase()}. Burns {ctx.supply.toLowerCase()} every step,
                  modulated by velocity deviation from φ. Cheap and automatic.
                </div>
              </div>
              <div>
                <div style={{ fontSize: "10px", color: C.blue, letterSpacing: "0.08em", fontWeight: 600, marginBottom: "6px" }}>
                  EXPANSION
                </div>
                <div style={{ fontSize: "11px", color: C.dim, lineHeight: 1.7 }}>
                  Conditional. Fires only when {ctx.supply.toLowerCase()}-to-{ctx.demand.toLowerCase()} ratio
                  falls below the lower stability band. Not discretionary. Triggered by measurable depletion.
                </div>
              </div>
              <div>
                <div style={{ fontSize: "10px", color: C.gold, letterSpacing: "0.08em", fontWeight: 600, marginBottom: "6px" }}>
                  PROGRESSIVE RESISTANCE
                </div>
                <div style={{ fontSize: "11px", color: C.dim, lineHeight: 1.7 }}>
                  Each expansion delivers less than the last at the same depletion level.
                  As {ctx.supply.toLowerCase()} approaches the ceiling, the damping factor decreases monotonically, reducing expansion authority as cumulative issuance grows. Structurally harder to inflate.
                </div>
              </div>
            </div>
          </>
        )}

        {/* ═══ AUDIT CHAIN VIEW ═══ */}
        {activeView === "audit" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div>
                <div style={{ fontSize: "14px", color: C.gold, fontWeight: 600, fontFamily: display }}>
                  Deterministic Audit Trail
                </div>
                <div style={{ fontSize: "11px", color: C.dim, marginTop: "4px" }}>
                  SHA-256 hash chain. Each step chains from the previous. Tamper-evident and append-only.
                </div>
              </div>
              <button
                onClick={verifyChain}
                style={{
                  padding: "8px 18px", fontSize: "11px", fontWeight: 600,
                  background: C.gold + "18", color: C.gold,
                  border: `1px solid ${C.gold}44`,
                  borderRadius: "4px", cursor: "pointer", fontFamily: mono,
                  letterSpacing: "0.04em",
                }}
              >
                VERIFY CHAIN
              </button>
            </div>

            {verifyResult && (
              <div style={{
                padding: "10px 16px", marginBottom: "16px",
                background: verifyResult.valid ? C.green + "14" : C.red + "18",
                border: `1px solid ${verifyResult.valid ? C.green + "44" : C.red + "55"}`,
                borderRadius: "5px", fontSize: "12px",
                color: verifyResult.valid ? C.green : C.red,
                fontWeight: 600,
              }}>
                {verifyResult.valid ? "CHAIN INTACT" : "CHAIN BROKEN"} — {verifyResult.msg}
              </div>
            )}

            <div style={{
              background: C.panel, border: `1px solid ${C.border}`,
              borderRadius: "5px", overflow: "hidden",
            }}>
              <div style={{
                display: "grid", gridTemplateColumns: "60px 1fr 120px",
                padding: "10px 16px", borderBottom: `1px solid ${C.border}`,
                fontSize: "9px", color: C.muted, letterSpacing: "0.08em",
              }}>
                <span>STEP</span>
                <span>HASH</span>
                <span style={{ textAlign: "right" }}>CHAINS FROM</span>
              </div>
              <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                {hashChain.slice(-50).reverse().map((h, i) => (
                  <div key={h.step} style={{
                    display: "grid", gridTemplateColumns: "60px 1fr 120px",
                    padding: "7px 16px",
                    borderBottom: `1px solid ${C.border}22`,
                    fontSize: "11px",
                    background: i % 2 === 0 ? "transparent" : C.surface + "40",
                  }}>
                    <span style={{ color: C.dim }}>{h.step}</span>
                    <span style={{ color: C.cyan, fontFamily: mono, fontSize: "10px", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {h.hash.slice(0, 48)}...
                    </span>
                    <span style={{ color: C.muted, textAlign: "right", fontSize: "10px" }}>
                      {h.prevHash ? h.prevHash.slice(0, 12) + "..." : "genesis"}
                    </span>
                  </div>
                ))}
                {hashChain.length === 0 && (
                  <div style={{ padding: "30px 16px", textAlign: "center", color: C.muted, fontSize: "12px" }}>
                    Press OBSERVE to begin generating the audit chain.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── FOOTER ───────────────────────────────────────────── */}
      <div style={{
        borderTop: `1px solid ${C.border}`,
        padding: "16px 28px",
        display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "8px",
        background: C.surface + "40",
      }}>
        <span style={{ fontSize: "10px", color: C.muted }}>
          © Valraj Singh Mann — Mann Mechanics — UKIPO GB2513172.3
        </span>
        <span style={{ fontSize: "10px", color: C.muted }}>
          Not production software — Not financial advice
        </span>
      </div>
    </div>
  );
}
