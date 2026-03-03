# Progressive Depletion Minting (PDM)

## Reference Implementation - Personal Edition v1.0.1

A deterministic control mechanism governing the expansion and contraction of bounded resource pools in response to measurable system conditions. Supply is added only when auditable depletion is detected, and each successive expansion becomes structurally more resistant than the last.

**Patent:** UKIPO GB2513172.3 (filed August 2025)
**Author:** Valraj Singh Mann
**Framework:** Mann Mechanics
**Registration:** Safe Creative Work ID 2601084210286 (January 8, 2026)

---

## What PDM Does

PDM replaces discretionary supply expansion with a mathematically enforced control law. Three components operate on every step:

**Burn.** Supply contracts continuously in proportion to system activity, modulated by velocity deviation from the target ratio φ.

**Conditional Mint.** New supply is added only when the supply-to-obligation ratio falls below a defined stability band. If the ratio is within or above the band, minting is zero.

**Progressive Damping.** When minting triggers, an exponential damping function reduces the amount delivered. As supply approaches the capacity ceiling, mint authority asymptotically approaches zero.

---

## Formal Guarantees

The following properties hold unconditionally for all valid parameter configurations and all non-negative inputs:

| Guarantee                  | Description                                                 |
| -------------------------- | ----------------------------------------------------------- |
| Non-negativity             | Supply cannot fall below zero (Theorem 1)                   |
| Capacity boundedness       | Supply cannot exceed M (Theorem 2)                          |
| Progressive resistance     | Mint delta strictly decreases as supply rises (Theorem 3)   |
| Conditional minting        | Expansion occurs only on measurable band breach (Theorem 4) |
| Deterministic auditability | Each step is hash-chained via SHA-256                       |

All guarantees are formally proven in the whitepaper and empirically verified by the simulation harness.

---

## Repository Contents

| Path                                         | Description                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `main.go`                                    | Core `StepPDM` function, `ValidatePDMConfig`, state management, HTTP API |
| `config.go`                                  | YAML configuration loading and validation                                |
| `telemetry.go`                               | Telemetry source abstraction (manual, CSV, webhook)                      |
| `web/index.html`                             | Browser-based monitoring dashboard                                       |
| `main_test.go`                               | Guardrail tests for trace format integrity                               |
| `simulation/`                                | Standalone verification harness (zero external dependencies)             |
| `PDM_Personal_Edition_Whitepaper_v1.0.1.pdf` | Full technical whitepaper with proofs and simulation results             |

---

## Verification

The `simulation/` directory contains a self-contained binary that exercises `StepPDM` across seven defined regimes:

* Stable equilibrium
* Demand shock
* Progressive resistance sweep
* Cap enforcement
* Non-negativity under extreme burn
* Conditional minting sweep
* Hash chain integrity

Full results are documented in Appendix C of the whitepaper.

```bash
cd simulation
go build -o sim .
./sim
```

---

## Domain Scope

PDM is domain-agnostic. The mechanism applies wherever a bounded resource requires controlled expansion, including energy grids, credit systems, carbon markets, bandwidth allocation, inventory management, healthcare capacity, monetary systems, and other environments where supply decisions are presently discretionary.

The mathematics is invariant to interpretation. “Supply” may represent tokens, compute capacity, credits, inventory units, emission allowances, or any other bounded resource.

---

## Intended Audience

This repository is intended for:

* Researchers
* Students
* Engineers exploring mechanism design
* Policy analysts and institutional evaluators
* Individuals assessing conceptual feasibility

It is not intended for unsupervised deployment or commercial use.

---

## What This Repository Is

* A reference implementation
* A deterministic demonstration engine
* A research and learning artefact
* A non-commercial Personal Edition of PDM
* A behavioural simulator of mechanism dynamics

## What This Repository Is Not

* A production-ready system
* A certified or compliant implementation
* A commercial product
* Financial, legal, or economic advice
* A guarantee of real-world outcomes

This implementation is not claim-complete with respect to all possible patented PDM methods and must not be represented as such.

---

## Licensing & Rights

This code is released under the **PDM Personal Edition License** (see `LICENSE.txt`).

* Non-commercial use is permitted
* Commercial use requires a separate written licence
* No rights of certification, compliance, or endorsement are granted

Patent protections may apply independently of the software licence. Nothing in this repository grants rights under patent law.

---

## Standards & Certification

This repository represents a reference implementation only.

Standards definition and certification pathways are administered by **MannCert** (manncert.org). Licensing, advisory services, and institutional engagements are handled separately by **Mann Mechanics** (mannmechanics.com).

Use of this code does not confer certification status, compliance claims, or authorised implementation rights.

---

## Contributions

To preserve specification integrity and deterministic behaviour, external pull requests are not accepted.

Questions and academic discussion may be raised via issues for explanatory purposes.

---

## Disclaimer

This software is provided “AS IS”, without warranty of any kind. The author makes no representations regarding correctness, fitness for purpose, or suitability for any application. All use is at the user's own risk. See `DISCLAIMER.txt` for full terms.

---

## Registration & Provenance

* **Patent:** UKIPO Application GB2513172.3 (filed August 2025)
* **Safe Creative Registration:** Work ID 2601084210286 (January 8, 2026)
* **Repository:** github.com/mannmechanics/pdm-personal-edition-reference

---

*This implementation demonstrates mechanism behaviour only. It is not production software. Sector-specific deployment, calibration, certification, and commercial implementation require appropriate licensing and governance.*

© Valraj Singh Mann. All rights reserved.
