# PDM Personal Edition Reference Simulator

**Supporting Documentation**
Version 1.0.1 | Author: Valraj Singh Mann | Framework: Mann Mechanics
UKIPO GB2513172.3

---

## 1. Purpose

This simulator is a browser-based reference implementation of the Progressive Depletion Minting (PDM) control mechanism. It reproduces the exact state transition function (StepPDM) from the Go reference codebase (pdm-personal/main.go v1.0.1) and allows users to observe PDM behaviour under configurable telemetry regimes, including compound multi-phase stress testing.

It is designed for testing, education and personal research. It is not production software. Commercial deployment requires separate licensing and domain-specific calibration.

---

## 2. What the Simulator Does

The simulator runs the PDM step function repeatedly against a stream of telemetry inputs (obligation O and activity V), producing a new supply value S at each step. Every step is recorded, hashed and displayed across a set of live charts and data tables.

The user can observe how the mechanism responds to different demand conditions, how the burn and mint components interact asymmetrically, and how the progressive damping function restricts expansion authority as supply grows toward the capacity ceiling.

---

## 3. The Control Law

PDM operates through three interlocking components applied in sequence at each step.

### 3.1 Activity-Scaled Burn (Contraction)

Supply is contracted proportionally to system activity. The burn rate is modulated by how far the system velocity deviates from the target ratio phi (0.618). Burn is continuous and operates on every step. Contraction is cheap and automatic.

```
velocity   = V / max(S, S_min)
burnRate   = max(0, 1 - k * (velocity - phi))
burnAmount = B * burnRate * V
S_temp     = max(0, S - burnAmount)
```

### 3.2 Conditional Minting (Expansion)

New supply is added only when the supply-to-obligation ratio L = S_temp / O falls below a defined lower stability band (bL). If L is within or above the band, minting is zero. This is not discretionary. It is triggered by an auditable, measurable condition.

```
mintRaw = max(0, phi * O - S_temp)
```

### 3.3 Progressive Damping

When minting does trigger, the amount actually added is reduced by an exponential damping function:

```
lambda = phi ^ (S_temp / M)
delta  = mintRaw * lambda
```

As supply approaches the hard capacity ceiling M, the damping factor lambda approaches zero. This means the system becomes structurally harder to inflate the more it has already been inflated. This is the "progressive" property that gives the mechanism its name.

### 3.4 Capacity Enforcement

```
S_new = min(M, S_temp + delta)
```

If capping activates, delta is retroactively adjusted so that S_new = M exactly.

---

## 4. The Five Formal Guarantees

These properties hold unconditionally for all valid parameter configurations and all non-negative telemetry inputs.

**1. Non-negativity.** Supply can never go below zero.

**2. Capacity boundedness.** Supply can never exceed M.

**3. Conditional minting.** Expansion occurs only when L falls below bL.

**4. Progressive resistance.** The damping factor lambda = phi^(S/M) decreases monotonically as supply approaches the capacity ceiling, reducing expansion authority as cumulative issuance grows.

**5. Deterministic auditability.** Every step is fully traceable via a SHA-256 hash chain.

The simulator displays live confirmation of guarantees 1 and 2 in the Parameters tab. Guarantee 3 is enforced by the band evaluation logic. Guarantee 4 is visible in the lambda chart. Guarantee 5 is verifiable via the Audit Chain tab.

---

## 5. Telemetry Profiles

The simulator includes seven fixed telemetry profiles that map to the whitepaper simulation regimes, plus a programmable regime sequence mode. In the simulator, O and V are synthetic telemetry inputs representing external demand and activity signals. They are not endogenous variables produced by the model. The mechanism consumes them as given inputs, consistent with the plant/controller boundary described in Section 6 of the whitepaper.

| Profile | Description | Whitepaper Ref |
|---|---|---|
| Stable Equilibrium | O = 1M steady, V = 50k to 60k random. System stays in-band with gentle burns. | Appendix C.1 |
| Demand Shock | O = 2M, V = 80k. Supply starts at 40% of M. Heavy minting, cap-limited recovery. | Appendix C.2 |
| Oscillating Demand | O swings 800k to 1.2M on a sine wave (period 40 steps). Tests band transitions. | N/A |
| Drought Then Shock | Low O for 30 steps, then sudden jump to O = 3M. Tests deep depletion recovery. | N/A |
| Extreme Burn | V = 999,999,999 with tiny supply. Tests non-negativity under adversarial throughput. | Appendix C.5 |
| Cap Saturation | O = 50M, V = 100. Tests cap enforcement under maximum minting pressure. | Appendix C.4 |
| Custom | Manual entry of O and V for freeform experimentation. | N/A |

All profiles except Custom use a seeded pseudo-random number generator (Mulberry32) for reproducibility. The same seed produces the same sequence every time. The PRNG is used only for reproducible telemetry generation and does not influence the StepPDM control law itself.

---

## 6. Regime Sequence Testing

The Regime Sequence profile enables compound stress testing by defining a sequence of telemetry blocks that execute in order during a single continuous run. Supply, the cumulative ledger, and the hash chain carry through across regime transitions without resetting. This tests the controller's response to non-stationary conditions where demand, activity, and stress levels change during a single run.

### 6.1 Block Structure

Each block in a regime sequence defines: O (obligation), the demand level for this phase; V (activity), the throughput level for this phase; Steps, the duration in simulation steps; Burst Chance, the probability per step of a random V spike (0 to 1); and Burst Scale, a multiplier applied to V during a burst (e.g. 1.5 = 50% spike). Small seeded noise is applied to both O and V within each block for realism.

### 6.2 Pre-built Presets

Six pre-built regime sequences are included for structured stress testing.

**Multi-Regime Stress.** 10 blocks cycling through five economic states (stable economy, growth boom, speculative surge, panic liquidation, liquidity drought). Each block runs for 100 steps. Tests compound disturbance stability and regime-transition recovery.

**Black Swan.** Normal operation (200 steps), then a mass liquidation spike with O = 950k and V = 1.3M for 100 steps, then an immediate post-crash vacuum with O = 400k and V = 25k for 100 steps, followed by slow recovery. Tests crisis response and post-crisis stabilisation.

**Rapid Demand Collapse.** Starting supply at 80% of M, demand drops to 300k for 500 steps. Tests slow contraction, burn dominance, and whether the system eventually recovers when demand returns.

**Hyper-Velocity Shock.** Two extreme V spikes (250k and 300k) with cooldown periods between each. Tests burn instability, oscillation amplitude, and convergence after velocity normalises.

**Capacity Spiral.** Demand grows continuously from 600k to 2M over 700 steps. Tests cap enforcement under sustained and escalating pressure, and behaviour when phi times O exceeds M.

**Liquidity Whiplash.** Rapid alternation between high V (280k to 350k) and low V (20k to 25k) across six transitions. Tests control-loop oscillation, damping effectiveness, and whether amplitude grows or decays.

### 6.3 Custom Regimes

The Custom Regime option allows building a regime sequence from scratch. Blocks can be added, removed, and edited individually through the Parameters tab. Each block's O, V, steps, burst chance, and burst scale are independently configurable.

### 6.4 What Regime Testing Reveals

Fixed telemetry profiles test the controller's response to isolated, stationary conditions. Regime sequences test its response to compound, non-stationary conditions where multiple disturbances overlap. This is closer to real-world operating environments.

The key metrics to observe during regime testing are: whether supply remains bounded across all transitions, whether the accounting identity holds continuously, whether the system recovers after each regime change, and how many steps recovery takes after each transition.

---

## 7. The Accounting Identity

The simulator maintains a cumulative ledger of total burned and total minted across all steps. The accounting identity is:

```
S = S_0 - totalBurned + totalMinted
```

This is displayed live on the Dashboard tab. It holds exactly because trace.delta is already cap-adjusted before entering the ledger (per Section 4.6 of the whitepaper). Any observed drift is floating-point rounding only and is flagged if it exceeds 0.01.

---

## 8. The Hash Chain

Each step trace is serialised to JSON and chained via SHA-256:

```
hash_t = SHA-256(hash_(t-1) || JSON(trace_t))
```

This produces a tamper-evident, append-only audit trail. Any modification to historical trace data invalidates all subsequent hashes.

The Audit Chain tab displays the chain and provides a verification button that recomputes every hash in the retained window (last 300 steps) and confirms integrity. Verification covers the retained window, not the full run history beyond that window.

> **Note on scope:** The hash algorithm is the same as the Go reference implementation (Section 4.7 of the whitepaper), but the serialisation format differs (JavaScript JSON.stringify vs Go json.Marshal). Hashes are deterministic within this simulator but are not byte-identical to the Go reference. Cross-language hash verification would require a shared canonical encoding.

---

## 9. The Dashboard

The Dashboard tab displays six live visualisations.

**L Ratio Trajectory.** The supply-to-obligation ratio over time, with the stability band [bL, bH] and phi target marked. This is the primary indicator of mechanism state.

**Supply Trajectory.** Absolute supply level over time, with M marked as the ceiling.

**Mint vs Burn Per Step.** Bar chart showing the asymmetry between continuous burn and conditional mint events.

**Lambda (Progressive Resistance).** The damping factor phi^(S/M) over time. As supply grows, lambda falls, reducing mint authority.

**Telemetry Inputs.** O and V over time, showing the demand conditions driving the mechanism.

**Step Telemetry Panel.** Full trace of the most recent step, showing every intermediate value computed by StepPDM.

---

## 10. Band Convention

The simulator uses a half-open band convention, consistent with the whitepaper:

```
BELOW    if L < bL   (minting may trigger)
IN BAND  if bL <= L < bH   (no intervention)
ABOVE    if L >= bH  (no intervention)
```

This is documented in the Parameters tab of the simulator.

---

## 11. Export

Two export modes are available from the Step History tab.

**Export Window.** The last 300 steps with full trace data, including the hash body used for chain computation. This is audit-grade and sufficient to independently verify the hash chain for the retained window.

**Export Full Run.** Every step since the last reset, with minimal fields (step, S, O, V, L, burn, delta, lambda, band, hash). This is telemetry-grade and suitable for time-series analysis. It does not include the hash body, so independent chain recomputation is not possible from this export alone. When running a regime sequence, each step includes the active regime label for post-run analysis of behaviour across transitions.

Export delivery adapts to the runtime environment. In a standard browser context, a JSON file download is triggered. In sandboxed environments (such as embedded iframes), the data is copied to the clipboard instead. A status message confirms which delivery method was used.

---

## 12. Parameters

All mechanism parameters are configurable in the Parameters tab while the simulator is stopped. Changing any parameter triggers a clean reinitialisation.

| Parameter | Symbol | Default | Constraint |
|---|---|---|---|
| Ratio target | phi | 0.618 | 0 < phi < 1 |
| Lower band | bL | 0.60 | 0 < bL <= phi |
| Upper band | bH | 0.62 | phi <= bH |
| Burn base | B | 0.000618 | B >= 0 |
| Velocity sensitivity | k | 0.1 | k >= 0 |
| Maximum capacity | M | 1,000,000 | M > 0 |
| Starting supply | S_0 | 61.8% of M | 0 < S_0 <= M |
| PRNG seed | seed | 42 | any integer |

These defaults match the Personal Edition test profile defined in the whitepaper (Appendix A).

---

## 13. What This Simulator Does Not Do

It does not claim macroeconomic stability in any specific deployment. It does not claim regulatory compliance. It does not claim production readiness. It does not guarantee immunity to telemetry manipulation. These are domain-dependent properties that require a stated plant model, threat model and empirical methodology to evaluate.

The simulator tests the control law's response to exogenous telemetry. It does not model agent behaviour, reflexive market dynamics, or strategic manipulation. Those are separate concerns that require agent-based simulation methodology and are outside the scope of this reference tool.

What it does establish is a deterministic, auditable, bounded, conditionally-minting, progressively-damped control law with formally guaranteed structural properties.

---

## 14. Technical Notes

The simulator is written as a single React (JSX) component using Recharts for visualisation. It has no external backend dependencies. All computation happens in the browser.

Runtime state is managed through React refs (single source of truth for computation) with React state used only as a render mirror. This eliminates stale-closure and double-tick issues that affect interval-driven simulators.

The SHA-256 implementation uses the Web Crypto API where available (secure contexts) with a pure JavaScript fallback for environments where crypto.subtle is not present. The availability check is performed at call time, not at module load, ensuring correct behaviour in SSR and late-injection contexts.

The PRNG (Mulberry32) is a well-characterised 32-bit generator suitable for simulation reproducibility. It is not cryptographically secure, nor does it need to be. The PRNG is used only for reproducible telemetry generation and does not influence the StepPDM control law itself.

---

## 15. Reference Documents

PDM Personal Edition Whitepaper v1.0.1, Valraj Singh Mann, Mann Mechanics

PDM Personal Edition Reference Implementation (Go): [github.com/mannmechanics/pdm-personal-edition-reference](https://github.com/mannmechanics/pdm-personal-edition-reference)

UKIPO Patent Application GB2513172.3 (filed August 2025)

Safe Creative Registration, Work ID 2601084210286 (January 2026)

---

*This simulator is provided for educational, research and non-commercial demonstration purposes only. It is not financial advice. Commercial use, production deployment or claims of certification are prohibited without explicit written licence from the rights holder.*

*© Valraj Singh Mann. All rights reserved.*
