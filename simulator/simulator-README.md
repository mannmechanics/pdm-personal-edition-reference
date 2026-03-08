# PDM Personal Edition Reference Simulator

A browser-based reference simulator for the Progressive Depletion Minting (PDM) control mechanism. Reproduces the exact `StepPDM` state transition function from `main.go` v1.0.1 and provides configurable telemetry profiles, live charting, accounting verification, and a SHA-256 audit chain.

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

Six telemetry profiles are included, mapping to the whitepaper simulation regimes:

| Profile | Description | Whitepaper Reference |
|---|---|---|
| Stable Equilibrium | O = 1M steady, V = 50k-60k random | Appendix C.1 |
| Demand Shock | O = 2M, V = 80k, S starts at 40% of M | Appendix C.2 |
| Oscillating Demand | O swings 800k to 1.2M on a sine wave | -- |
| Drought Then Shock | Low O for 30 steps, then O jumps to 3M | -- |
| Extreme Burn | V = 999,999,999 with tiny supply | Appendix C.5 |
| Cap Saturation | O = 50M, V = 100 | Appendix C.4 |

A seventh mode (Custom) allows manual entry of O and V.

All profiles use a seeded pseudo-random number generator (Mulberry32) for reproducibility. The same seed produces the same sequence every time. The PRNG is used only for telemetry generation and does not influence the StepPDM control law itself.

## Control Law

The `StepPDM` function in this simulator is identical to `pdm-personal/main.go` v1.0.1. The control law, parameter defaults, clamp logic, and band evaluation are reproduced line for line.

The five formal guarantees from the whitepaper (Section 5) are enforced by the code and visible in the simulator UI:

1. Non-negativity: S >= 0
2. Capacity boundedness: S <= M
3. Conditional minting: delta > 0 only if L < bL
4. Progressive resistance: lambda = phi^(S/M) decreasing monotonically
5. Deterministic auditability: SHA-256 hash chain

## Parameters

All mechanism parameters are configurable while the simulator is stopped. Changing any parameter triggers a clean reinitialisation.

| Parameter | Symbol | Default | Constraint |
|---|---|---|---|
| Ratio target | phi | 0.618 | 0 < phi < 1 |
| Lower band | bL | 0.60 | 0 < bL <= phi |
| Upper band | bH | 0.62 | phi <= bH |
| Burn base | B | 0.000618 | B >= 0 |
| Velocity sensitivity | k | 0.1 | k >= 0 |
| Maximum capacity | M | 1,000,000 | M > 0 |
| Starting supply | S0 | 61.8% of M | 0 < S0 <= M |
| PRNG seed | seed | 42 | any integer |

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

Two export modes are available from the Step History tab:

- **Export Window**: Last 300 steps with full trace data including the hash body. Audit-grade. Sufficient to independently verify the hash chain for the retained window.
- **Export Full Run**: Every step since last reset with minimal fields (step, S, O, V, L, burn, delta, lambda, band, hash). Telemetry-grade. Suitable for time-series analysis. Does not include the hash body.

Export adapts to the runtime environment. In a standard browser context, a JSON file download is triggered. In sandboxed environments, the data is copied to the clipboard.

## Band Convention

The simulator uses a half-open band convention consistent with the whitepaper:

- BELOW: L < bL (minting may trigger)
- IN BAND: bL <= L < bH (no intervention)
- ABOVE: L >= bH (no intervention)

## Documentation

The file `PDM_Simulator_Supporting_Documentation.pdf` in this directory provides a full description of the simulator, the control law, the formal guarantees, the telemetry profiles, the accounting identity, the hash chain, the dashboard charts, and the parameters. It is written for audiences who understand control mechanisms.

## What This Simulator Does Not Do

It does not claim macroeconomic stability in any specific deployment. It does not claim regulatory compliance. It does not claim production readiness. It does not guarantee immunity to telemetry manipulation.

What it does establish is a deterministic, auditable, bounded, conditionally-minting, progressively-damped control law with formally guaranteed structural properties.

## Files

```
simulator/
  pdm-simulator.jsx                          React component
  PDM_Simulator_Supporting_Documentation.pdf Supporting documentation
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
