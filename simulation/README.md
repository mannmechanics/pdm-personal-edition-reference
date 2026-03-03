# PDM Simulation Harness

Deterministic verification harness for Progressive Depletion Minting (PDM) Personal Edition v1.0.1.

This binary exercises the `StepPDM` state transition function directly and validates all formal guarantees stated in the whitepaper against reproducible test scenarios.

## Scope

This harness verifies mechanism-level invariants only. It does not claim domain-level stability or macroeconomic performance.

All tests correspond explicitly to formal statements in the whitepaper.

## Test Coverage

| Test | Whitepaper Reference | Verification Objective |
|------|---------------------|------------------------|
| Stable equilibrium | Section 6 | Under bounded telemetry, L remains near φ and minting is suppressed inside the stability band |
| Demand shock | Sections 4.6, 5 | Minting triggers on band breach; recovery is bounded by capacity M |
| Progressive resistance | Theorem 3 | For fixed depletion, Δ strictly decreases as S increases |
| Cap enforcement | Theorem 2 | Supply is bounded: S ≤ M at all steps |
| Non-negativity | Theorem 1 | Supply remains S ≥ 0 under all tested conditions |
| Conditional minting | Theorem 4 | Minting occurs only when L < b_L |
| Hash chain integrity | Section 4.7 | Each trace hash chains deterministically from the previous |

## How to Run
```bash
cd simulation
go build -o sim .
./sim
```

No external configuration files are required.

## Dependencies

None.

The binary is self-contained. The core `StepPDM` function and `ValidatePDMConfig` are embedded directly from `main.go` to ensure:

- Deterministic verification
- Independence from HTTP, telemetry ingestion, or scheduler layers
- Reproducibility of all invariant checks

## Output

The simulation prints:

- Step-by-step results per scenario
- Mint activation counts
- Cap engagement confirmation
- Progressive damping monotonicity table
- Hash chain validation

A final summary table confirms whether each formal guarantee is satisfied.

Quantitative results are reproduced in Appendix C of the whitepaper.
