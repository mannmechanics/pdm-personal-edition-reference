# PDM Reference Simulator

## Reproducibility Guide

### Independent Verification of Stability Properties

---

| Property | Value |
|---|---|
| Simulator | PDM Personal Edition Reference Simulator v1.0.1 |
| Simulator URL | mannmechanics.com/pdm-simulator |
| Repository | github.com/mannmechanics/pdm-personal-edition-reference |
| Patent | UKIPO GB2513172.3 |
| Controller | StepPDM (faithful reproduction of pdm-personal/main.go v1.0.1) |
| Environment | Any modern browser (Chrome, Firefox, Safari, Edge) |
| Default Seed | 42 |
| Determinism | Seeded PRNG (Mulberry32), SHA-256 hash chain per step |

*This document enables independent reviewers to reproduce the stability analysis results for the Progressive Depletion Minting (PDM) control law. All experiments described here can be completed in under five minutes using the public simulator.*

---

### Quick Verification (30 Seconds)

1. Open the simulator at mannmechanics.com/pdm-simulator
2. Select Regime Sequence (Multi-Regime Stress)
3. Seed = 42
4. Run 1000 steps
5. Click Stability Analysis tab, press Run Analysis

**Expected result:** `EMPIRICAL_LYAPUNOV_CONDITION_SATISFIED` with monotonic restoring force on the primary (L-based) candidate.

---

## 1. Default Controller Parameters

All experiments in this guide use the following default configuration unless otherwise stated. These values match the Go reference implementation (DefaultConfig).

| Parameter | Symbol | Default Value |
|---|---|---|
| Ratio target | φ (phi) | 0.618 |
| Lower band | bL | 0.60 |
| Upper band | bH | 0.62 |
| Burn base | B | 0.000618 |
| Velocity sensitivity | k | 0.1 |
| Max capacity | M | 1,000,000 |
| Initial supply | S₀ | 60% of M |

---

## 2. Reproducing the Lyapunov Stability Analysis

This experiment verifies that the controller exhibits stochastic Lyapunov stability under multi-regime stress conditions.

### Procedure

1. Open the PDM Reference Simulator in a browser.
2. Set Profile to Regime Sequence.
3. Select the Multi-Regime Stress preset (default).
4. Set Seed to 42 in the Parameters tab.
5. Confirm all controller parameters match the defaults in Section 1.
6. Set Speed to Fast (200ms) and multiplier to x25.
7. Press Run. Allow the simulation to complete 1000 steps (the full regime schedule).
8. Press Stop.
9. Navigate to the Stability Analysis tab.
10. Press Run Analysis.

### Expected Results

| Metric | Expected Value |
|---|---|
| Verdict | EMPIRICAL_LYAPUNOV_CONDITION_SATISFIED |
| Primary candidate | V_L = (L - φ)² where L = sTemp/O |
| Monotonic restoring force | true |
| Single-step E[ΔV] (primary) | Negative (approx. -0.00032) |
| 10-step E[ΔV] at 95th percentile | Strongly negative (approx. -0.080) |
| Safety invariants | ALL HELD |
| K-step crossover | k = 1 (negative from first step) |
| Secondary candidate (S/M) restoring force | NOT CONFIRMED (expected) |

The dual-candidate comparison is a critical verification point. The primary candidate (L-based) must show monotonic restoring force. The secondary candidate (S/M-based) must fail, because the controller regulates L = sTemp/O, not S/M. If both candidates show identical results, the analysis may be computing the wrong variable.

### Data Export

Press Export Analysis to download the full results as JSON. The exported file contains all percentile-tier conditional expectations, the k-step drift curve, normalised gain per regime, and field definitions. This file can be independently analysed outside the simulator.

---

## 3. Reproducing the Parameter Stability Sweep

This experiment maps the contraction coefficient α across a grid of controller parameters to verify that stability is robust to tuning variation.

### Procedure

1. Complete the steps in Section 2 (or start a fresh session).
2. Navigate to the Stability Analysis tab.
3. Scroll to the Parameter Stability Heatmap section.
4. Press Run Sweep.
5. Wait for completion (625 configurations, approximately 10-30 seconds).

### Sweep Configuration

| Setting | Value |
|---|---|
| burnBase range | 0.0001 to 0.003 |
| burnVelocityK range | 0.0 to 0.5 |
| Grid resolution | 25 x 25 (625 configurations) |
| Steps per run | 2,000 |
| Burn-in period | 1,000 steps (discarded) |
| Telemetry | Multi-Regime Stress preset, seed 42 |

### Expected Results

| Metric | Expected Value |
|---|---|
| Total configurations | 625 |
| Stable configurations (α > 0) | 625 (100%) |
| Unstable configurations | 0 |
| α at current config | Approximately 0.002 |
| α minimum (weakest config) | Approximately 0.0004 |
| α maximum (strongest config) | Approximately 0.014 |
| Current config position | Centre of stable region |

The heatmap should appear entirely green (stable). The gold-bordered cell marks the current deployed configuration. Hovering over any cell displays the exact burnBase, burnVelocityK, and α values. Stability holds across a 30x burnBase range and a 0-0.5 velocity feedback range, confirming the controller is robustly stable and insensitive to tuning variation.

### Data Export

Press Export to download the sweep results as JSON. The file contains every (burnBase, burnVelocityK, α, meanV, meanDV, diverged) combination for independent analysis.

---

## 4. Reproducing the K-Step Drift Curve

The k-step drift curve is included in the stability analysis output (Section 2). It shows E[V(t+k) - V(t)] for k = 1 through 50 on the primary Lyapunov candidate.

### Expected Shape

| Property | Expected Behaviour |
|---|---|
| Unconditional drift (grey line) | Negative from k=1, monotonically decreasing, approximately linear |
| Conditional drift (cyan line) | Negative from k=1, approximately 6-7x stronger than unconditional |
| Slope | Approximately -0.00032 per step (unconditional) |
| Saturation | None visible at k=50 (controller still correcting) |

A linear k-step curve indicates constant per-step contraction, consistent with the stochastic Lyapunov inequality E[ΔV | L] <= -αV + ε. The absence of saturation at k=50 indicates the controller has not exhausted its corrective authority at that horizon.

---

## 5. Independent Stress Testing

Reviewers are encouraged to conduct their own experiments beyond the standard tests above. The simulator supports arbitrary configurations.

### Suggested Adversarial Tests

**Custom Regime Construction:** Select Profile, then Regime Sequence, then Custom Regime. Add blocks with extreme O and V values. For example, a pure Liquidity Drought scenario (O=450,000, V=30,000, 2000 steps) tests the controller under minimal activity where correction authority is weakest.

**Parameter Extremes:** In the Parameters tab, set burnBase to very low values (e.g. 0.0001) or burnVelocityK to zero. Run a regime sequence and check whether the stability analysis still shows restoring force.

**Manual Regime Switching:** Use Custom profile. Run for several hundred steps, press Stop, change controller parameters (φ, bL, bH, B, k), then press Run to continue. Supply state carries forward. This tests whether the controller recovers from mid-flight parameter shocks.

**Extreme Telemetry:** Use the Extreme Burn Pressure or Cap Saturation preset profiles to test safety invariant enforcement under adversarial conditions. Supply should never go negative or exceed M.

---

## 6. Export File Reference

All exports are JSON files containing the configuration, seed, timestamp, and results. The following exports are available.

| Export | Contents | Location |
|---|---|---|
| Full Run | Per-step telemetry: S, O, V, L, burn, delta, λ, band, hash, loadR, lyapV_L, lyapV_SM | History tab, Export Full Run |
| Stability Analysis | Dual-candidate Lyapunov analysis, percentile tiers, k-step curve, regime gains | Stability Analysis tab, Export Analysis |
| Parameter Sweep | 625-point α grid across burnBase x burnVelocityK | Stability Analysis tab, Export (sweep section) |
| Window Export | Last 300 steps with full trace detail | History tab, Export Window |

### Field Definitions (Full Run Export)

| Field | Definition |
|---|---|
| S | Supply after step (sNew) |
| L | sTemp / O -- band evaluation ratio (controller's regulated variable) |
| λ (lambda) | φ^(S/M) -- progressive damping factor |
| loadR | S / M -- normalised load ratio |
| lyapV_L | (L - φ)² -- PRIMARY Lyapunov candidate |
| lyapV_SM | (S/M - φ)² -- SECONDARY (valid only when O ≈ M) |

---

## 7. Version and Provenance

| Item | Detail |
|---|---|
| Simulator version | PDM Personal Edition Reference Simulator v1.0.1 |
| Simulator URL | mannmechanics.com/pdm-simulator |
| Controller source | pdm-personal/main.go v1.0.1 (Go reference implementation) |
| Repository | github.com/mannmechanics/pdm-personal-edition-reference |
| Repository commit | [Insert current commit hash before publication] |
| Patent | UKIPO GB2513172.3 (filed August 2025, WIPO acknowledged September 2025) |
| Author | Valraj Singh Mann |
| Entity | Mann Mechanics (mannmechanics.com) |
| PRNG | Mulberry32 (seeded, deterministic) |
| Hash chain | SHA-256, per-step, JSON-serialised trace input |

The simulator implements a faithful reproduction of the StepPDM function from the Go reference codebase. The control law, burn mechanics, band logic, and capacity enforcement are identical. Hash serialisation differs between JS (JSON.stringify) and Go (json.Marshal), so hashes are deterministic within the simulator but not byte-identical to the Go reference. This is documented in the simulator source.

---

*This simulator is a reference implementation for research and verification purposes. It is not production software and does not constitute financial advice. These results verify the stability properties of the PDM control law under the tested telemetry regimes. Deployment-layer concerns including telemetry integrity, oracle reliability, strategic behaviour, and market microstructure are outside the scope of this simulator and require separate validation.*

© Valraj Singh Mann. All rights reserved. Mann Mechanics. UKIPO GB2513172.3.
