# PDM Personal Edition Reference Simulator

A browser-based reference simulator for the Progressive Depletion Minting (PDM) control mechanism. Reproduces the exact `StepPDM` state transition function from `main.go` v1.0.1 and provides configurable telemetry profiles, live charting, accounting verification, a SHA-256 audit chain, Lyapunov stability analysis, and parameter robustness mapping.

**This is a testing and research tool.** For a non-configurable observation tool, see the [Equilibrium Demonstrator](../demonstrator/).

## Requirements

The simulator is a single React (JSX) component. To run it you need:

- Node.js 18+
- A React project (Create React App, Vite, Next.js, or equivalent)
- The following dependencies: `react`, `recharts`

## Setup

1. Create a React project if you do not already have one:

```
npx create-react-app pdm-simulator
cd pdm-simulator
npm install recharts
```

2. Copy `pdm-simulator.jsx` into your `src/` directory.

3. In your `src/App.js`, import and render the component:

```javascript
import PDMSimulator from './pdm-simulator';

function App() {
  return <PDMSimulator />;
}

export default App;
```

4. Start the development server:

```
npm start
```

The simulator will be available at `http://localhost:3000`.

## What It Does

The simulator runs `StepPDM` repeatedly against a stream of telemetry inputs (obligation O and activity V), producing a new supply value S at each step. Every step is recorded, hashed, and displayed across live charts and data tables.

### Telemetry Profiles

Six preset telemetry profiles are included, mapping to the whitepaper simulation regimes:

| Profile | Description | Whitepaper Reference |
|---|---|---|
| Stable Equilibrium | O = 1M steady, V = 50k-60k random | Appendix C.1 |
| Demand Shock | O = 2M, V = 80k, S starts at 40% of M | Appendix C.2 |
| Oscillating Demand | O swings 800k to 1.2M on a sine wave | -- |
| Drought Then Shock | Low O for 30 steps, then O jumps to 3M | -- |
| Extreme Burn | V = 999,999,999 with tiny supply | Appendix C.5 |
| Cap Saturation | O = 50M, V = 100 | Appendix C.4 |

A seventh mode (Custom) allows manual entry of O and V.

### Regime Sequences

The eighth mode (Regime Sequence) enables programmable multi-phase stress tests. Each phase defines an (O, V, duration) block with optional stochastic burst parameters. Supply state carries continuously through all phases without reinitialisation.

Six preset regime sequences are included:

| Preset | Description |
|---|---|
| Multi-Regime Stress | 5 economic regimes cycling every 100 steps with stochastic V bursts |
| Black Swan | Mass liquidation spike followed by post-crash vacuum |
| Rapid Demand Collapse | High supply with demand drop, tests slow contraction |
| Hyper-Velocity Shock | Extreme V with moderate demand, tests burn instability |
| Capacity Spiral | Continuously growing demand exceeding M |
| Liquidity Whiplash | Rapid alternation between high and low activity |

A Custom Regime builder allows creation of arbitrary phase sequences.

### Mid-Run Parameter Switching

Controller parameters (phi, bL, bH, B, k) can be changed while the simulator is stopped without resetting the supply state, step counter, hash chain, or ledger. Only structural parameters (M, S0, seed) trigger a full reinitialisation. This enables multi-regime chaos tests where controller tuning is changed mid-flight while supply carries forward.

All profiles use a seeded pseudo-random number generator (Mulberry32) for reproducibility. The same seed produces the same sequence every time. The PRNG is used only for telemetry generation and does not influence the StepPDM control law itself.

## Tabs

The simulator provides five tabs.

### Dashboard

Live charts showing L ratio with stability bands, supply trajectory, mint/burn per step, lambda damping, telemetry inputs, and full StepPDM trace for the current step. Metrics row displays supply, L ratio, lambda, total burned, total minted, and net delta. Accounting identity is verified continuously.

### Stability Analysis

One-click Lyapunov stability analysis across the full run. See the Stability Analysis section below for details.

### Step History

Scrollable table of the last 300 steps with full trace data. Includes Export Window (last 300 steps, audit-grade) and Export Full Run (every step since reset, telemetry-grade).

### Audit Chain

SHA-256 hash chain viewer and one-click chain verification. Displays the last 40 hashes with step numbers. The Verify Chain button recomputes hashes for the retained window and reports integrity.

### Parameters

Editable controller parameters, system variables, custom telemetry inputs, and regime sequence builder. All parameters are documented with constraints.

## Stability Analysis

The Stability Analysis tab computes a comprehensive stability assessment from the accumulated run data. It requires at least 50 steps and is most informative after a full 1000-step regime sequence.

### Dual-Candidate Lyapunov Analysis

The analysis computes two Lyapunov candidates simultaneously:

| Candidate | Formula | Role |
|---|---|---|
| Primary (V_L) | (L - phi)^2 where L = sTemp/O | Correct candidate. L is the variable the controller regulates. |
| Secondary (V_SM) | (S/M - phi)^2 | Comparison only. Valid only when O = M. |

For each candidate the analysis computes: V(t) summary statistics, single-step and multi-step (k=10) delta-V, percentile-tier conditional expectations (50th through 95th), monotonicity check, and median split test. Charts show V(t) trajectory and delta-V at both horizons.

The dual-candidate comparison serves as a built-in sanity check. The primary candidate should show monotonic restoring force. The secondary candidate should fail under variable-O telemetry, confirming the analysis is measuring the correct state variable.

### K-Step Drift Curve

Computes E[V(t+k) - V(t)] for k = 1 through 50 on the primary candidate. Two lines are plotted: unconditional (all steps) and conditional (V above median, i.e. system far from equilibrium). The chart reveals the timescale and magnitude of the controller's corrective authority. A crossover-k value identifies where unconditional drift becomes consistently negative.

### Normalised Gain Per Regime

For regime sequence runs, the analysis computes the normalised gain (delta-V / V) per regime, with coefficient of variation across regimes. This determines whether the controller exhibits constant-gain proportional behaviour or regime-dependent adaptive dynamics.

### Parameter Stability Sweep

A 625-point heatmap (25 x 25 grid) mapping the contraction coefficient alpha across burnBase (0.0001 to 0.003) and burnVelocityK (0.0 to 0.5). Each grid point runs an independent 2000-step simulation with 1000-step burn-in using the Multi-Regime Stress preset. The heatmap renders green for stable configurations (alpha > 0) and red for unstable (alpha < 0). The current deployed configuration is marked with a gold border.

### Exports

Three export buttons are available in the Stability Analysis tab:

- **Export Analysis**: Full Lyapunov analysis including both candidates, percentile tiers, k-step drift curve, regime gains, and field definitions.
- **Export (sweep)**: Complete 625-point parameter sweep grid with alpha, meanV, meanDV, and divergence flag for each configuration.
- **Export Full Run** (History tab): Per-step telemetry including loadR, lyapV_L, and lyapV_SM fields.

## Control Law

The `StepPDM` function in this simulator is identical to `pdm-personal/main.go` v1.0.1. The control law, parameter defaults, clamp logic, and band evaluation are reproduced line for line.

The five formal guarantees from the whitepaper (Section 5) are enforced by the code and visible in the simulator UI:

1. Non-negativity: S >= 0
2. Capacity boundedness: S <= M
3. Conditional minting: delta > 0 only if L < bL
4. Progressive resistance: lambda = phi^(S/M) decreasing monotonically
5. Deterministic auditability: SHA-256 hash chain

## Parameters

Controller parameters (phi, bL, bH, B, k) are configurable while the simulator is stopped. Changing these parameters does not reset the simulation state, enabling mid-run parameter switching for multi-regime stress tests.

Structural parameters (M, S0, seed) trigger a clean reinitialisation when changed.

| Parameter | Symbol | Default | Constraint | Reinitialises? |
|---|---|---|---|---|
| Ratio target | phi | 0.618 | 0 < phi < 1 | No |
| Lower band | bL | 0.60 | 0 < bL <= phi | No |
| Upper band | bH | 0.62 | phi <= bH | No |
| Burn base | B | 0.000618 | B >= 0 | No |
| Velocity sensitivity | k | 0.1 | k >= 0 | No |
| Maximum capacity | M | 1,000,000 | M > 0 | Yes |
| Starting supply | S0 | 61.8% of M | 0 < S0 <= M | Yes |
| PRNG seed | seed | 42 | any integer | Yes |

These defaults match the Personal Edition test profile (whitepaper Appendix A).

## Accounting Identity

The simulator maintains a cumulative ledger and displays the identity:

```
S = S0 - totalBurned + totalMinted
```

This holds exactly because `trace.delta` is already cap-adjusted before entering the ledger. Any observed drift is floating-point rounding only and is flagged if it exceeds 0.01.

## Hash Chain

Each step trace is serialised to JSON and chained via SHA-256:

```
hash_t = SHA-256(hash_(t-1) || JSON(trace_t))
```

The SHA-256 implementation uses the Web Crypto API where available, with a pure JavaScript fallback for environments where `crypto.subtle` is not present. The availability check is performed at call time.

The hash chain is deterministic within this simulator. It is not byte-identical to the Go reference implementation because JavaScript `JSON.stringify` and Go `json.Marshal` produce different serialisation output. Cross-language hash verification would require a shared canonical encoding.

## Export

### Full Run Export

Every step since last reset with the following fields:

| Field | Definition |
|---|---|
| step | Timestep index |
| S | Supply after step (sNew) |
| O | Obligation telemetry (effective) |
| V | Activity telemetry (vTotal) |
| L | sTemp / O (band evaluation ratio, controller's regulated variable) |
| burn | Burn amount |
| delta | Mint delta (cap-adjusted) |
| lambda | phi^(S/M) (progressive damping factor) |
| band | Band state (BELOW, IN_BAND, ABOVE) |
| hash | SHA-256 chain hash |
| loadR | S / M (normalised load ratio) |
| lyapV_L | (L - phi)^2 (primary Lyapunov candidate) |
| lyapV_SM | (S/M - phi)^2 (secondary Lyapunov candidate) |
| regime | Regime label (regime sequence runs only) |

### Window Export

Last 300 steps with full trace data including the hash body. Audit-grade. Sufficient to independently verify the hash chain for the retained window.

### Stability Analysis Export

Complete Lyapunov analysis results including both candidates, percentile-tier conditional expectations, k-step drift curve, normalised gain per regime, and field definitions.

### Parameter Sweep Export

Complete alpha grid across burnBase and burnVelocityK with per-configuration metrics.

Export adapts to the runtime environment. In a standard browser context, a JSON file download is triggered. In sandboxed environments, the data is copied to the clipboard.

## Band Convention

The simulator uses a half-open band convention consistent with the whitepaper:

- BELOW: L < bL (minting may trigger)
- IN BAND: bL <= L < bH (no intervention)
- ABOVE: L >= bH (no intervention)

## Reproducibility

All simulation runs are fully deterministic given the same seed and configuration. A reproducibility guide (`pdm-reproducibility-guide.docx`) is provided in this directory, enabling independent reviewers to replicate all stability analysis results in under five minutes.

Quick verification: select Regime Sequence (Multi-Regime Stress), seed 42, default parameters, run 1000 steps, open Stability Analysis, press Run Analysis. Expected result: EMPIRICAL_LYAPUNOV_CONDITION_SATISFIED with monotonic restoring force on the primary (L-based) candidate.

## Documentation

- `PDM_Simulator_Supporting_Documentation.pdf`: Full description of the simulator, control law, formal guarantees, telemetry profiles, accounting identity, hash chain, dashboard charts, and parameters.
- `pdm-reproducibility-guide.docx`: Step-by-step instructions for independent verification of stability properties, parameter sweeps, and adversarial testing.

## What This Simulator Does Not Do

It does not claim macroeconomic stability in any specific deployment. It does not claim regulatory compliance. It does not claim production readiness. It does not guarantee immunity to telemetry manipulation. It does not prove economic viability, oracle integrity, or resistance to strategic exploitation.

What it does establish is a deterministic, auditable, bounded, conditionally-minting, progressively-damped control law with formally guaranteed structural properties and empirically verified stochastic Lyapunov stability under multi-regime stress conditions.

## Files

```
simulator/
  pdm-simulator.jsx                          React component
  PDM_Simulator_Supporting_Documentation.pdf Supporting documentation
  pdm-reproducibility-guide.docx             Reproducibility guide
  README.md                                  This file
```

## References

- PDM Personal Edition Whitepaper v1.0.1 (repository root)
- PDM Personal Edition Reference Implementation (main.go, repository root)
- UKIPO Patent Application GB2513172.3 (filed August 2025)
- Safe Creative Registration, Work ID 2601084210286 (January 2026)

## Licence

This simulator is provided for educational, research, and non-commercial demonstration purposes only under the PDM Personal Edition License (see LICENSE.txt in the repository root). Commercial use, production deployment, or claims of certification are prohibited without explicit written licence from the rights holder.

No patent rights are granted by access to or use of this code.

(c) Valraj Singh Mann. All rights reserved.
