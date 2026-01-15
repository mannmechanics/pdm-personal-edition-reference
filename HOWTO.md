# PDM Personal Edition — Complete How-To Guide

A step-by-step guide to installing, configuring, and running the PDM Personal Edition heuristic stability engine.

---

## Table of Contents

1. [What Is This?](#what-is-this)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Running the System](#running-the-system)
6. [Using the Dashboard](#using-the-dashboard)
7. [Telemetry Modes](#telemetry-modes)
8. [API Reference](#api-reference)
9. [Understanding the Output](#understanding-the-output)
10. [Common Use Cases](#common-use-cases)
11. [Troubleshooting](#troubleshooting)
12. [How PDM Works (Simplified)](#how-pdm-works-simplified)

---

## What Is This?

PDM Personal Edition is a **heuristic stability engine** — a system that monitors a resource pool and applies corrective actions to maintain balance around a target ratio.

Think of it like a thermostat for resources:
- A thermostat maintains temperature around a target (e.g., 20°C)
- PDM maintains a ratio (L) around a target (φ ≈ 0.618)

**What it does:**
- Tracks your supply (S) against outstanding demand (Oi)
- Calculates the L ratio (S ÷ Oi)
- Burns supply in proportion to activity (V), modulated by velocity relative to the target (higher velocity reduces the burn multiplier in this reference controller)
- Mints (adds) supply when the ratio drops too low
- Logs every step with full audit trail

**What it doesn't do:**
- Create money or tokens
- Set prices
- Connect to exchanges or external systems
- Require certification (for personal/community use)

---

## Prerequisites

### Required

- **Go 1.21 or later** — [Download Go](https://go.dev/dl/)
- **A terminal/command line** — Terminal (Mac), Command Prompt/PowerShell (Windows), or any Linux terminal
- **A text editor** — VS Code, Sublime Text, Notepad++, or any editor you prefer

### Verify Go Installation

```bash
go version
```

You should see something like:
```
go version go1.21.0 darwin/amd64
```

If you get "command not found", install Go first.

---

## Installation

### Option 1: Download the Release

1. Download `pdm-personal-v1.0.0.zip`
2. Extract to a folder of your choice
3. Open a terminal in that folder

### Option 2: Clone from Repository

```bash
git clone https://github.com/yourusername/pdm-personal.git
cd pdm-personal
```

### Build the Binary

```bash
# Download dependencies
go mod tidy

# Build the executable
go build -o pdm-personal .
```

On Windows, the executable will be `pdm-personal.exe`.

### Verify the Build

```bash
# Linux/Mac
./pdm-personal --help

# Windows
pdm-personal.exe --help
```

You should see the program start (or an error about missing config, which we'll fix next).

---

## Configuration

### Step 1: Create Your Config File

```bash
cp config.yaml.example config.yaml
```

### Step 2: Edit the Config

Open `config.yaml` in your text editor. Here's what each section means:

```yaml
# ═══════════════════════════════════════════════════════════════════════
# POOL SETTINGS — Define your resource pool
# ═══════════════════════════════════════════════════════════════════════

pool:
  name: "My Resource Pool"        # Display name (shown in dashboard)
  mcap: 1000000                   # Maximum capacity — the hard ceiling
  initial_s: 618000               # Starting supply (typically ~61.8% of mcap)
```

**How to set these values:**

| Setting | What It Means | Example |
|---------|---------------|---------|
| `name` | Label for your pool | "Community Token", "Inventory Pool" |
| `mcap` | Maximum supply that can ever exist | 1000000 |
| `initial_s` | Where you're starting from | 618000 (61.8% of mcap) |

**Why 61.8%?** This is φ (phi), the golden ratio target. Starting here means you begin in equilibrium.

```yaml
# ═══════════════════════════════════════════════════════════════════════
# RESOURCE SETTINGS — What unit are you measuring?
# ═══════════════════════════════════════════════════════════════════════

resource:
  unit: "units"                   # Display label for your unit
```

Change this to whatever you're tracking: "tokens", "kg", "hours", "credits", etc.

```yaml
# ═══════════════════════════════════════════════════════════════════════
# TELEMETRY SETTINGS — How does the system get daily data?
# ═══════════════════════════════════════════════════════════════════════

telemetry:
  mode: "manual"                  # Options: "manual", "csv", "webhook"
  csv_path: "./data/telemetry.csv"
```

**Choose your mode:**

| Mode | Best For | How It Works |
|------|----------|--------------|
| `manual` | Testing, small projects | Enter values via dashboard or API |
| `csv` | Batch data, spreadsheets | Reads from a CSV file daily |
| `webhook` | Automation, integrations | Receives POST requests from external systems |

```yaml
# ═══════════════════════════════════════════════════════════════════════
# SCHEDULE SETTINGS — When does the daily PDM step run?
# ═══════════════════════════════════════════════════════════════════════

schedule:
  run_time: "00:00"               # Time in HH:MM format (24-hour)
  timezone: "UTC"                 # Your timezone
```

**Common timezone values:**
- `UTC` — Coordinated Universal Time
- `Europe/London` — UK time (handles BST automatically)
- `America/New_York` — US Eastern
- `America/Los_Angeles` — US Pacific
- `Asia/Tokyo` — Japan

```yaml
# ═══════════════════════════════════════════════════════════════════════
# DASHBOARD SETTINGS — Web interface configuration
# ═══════════════════════════════════════════════════════════════════════

dashboard:
  port: 8080                      # Port for the web server
  show_history_days: 30           # How many days to show in the chart
```

If port 8080 is in use, try 3000, 8000, or any port between 1024-65535.

```yaml
# ═══════════════════════════════════════════════════════════════════════
# ALERTS SETTINGS — Optional notifications (not implemented in v1.0.0)
# ═══════════════════════════════════════════════════════════════════════

alerts:
  enabled: false
  webhook_url: ""
```

Leave this as-is for now. Alert functionality is reserved for future versions.

---

## Running the System

### Start the Server

```bash
# Linux/Mac
./pdm-personal

# Windows
pdm-personal.exe
```

You should see:
```
2025/01/07 12:00:00 Loaded config: Pool=My Resource Pool, Mode=manual, Port=8080
2025/01/07 12:00:00 Bootstrapped from config.yaml
2025/01/07 12:00:00 PDM Personal Edition starting on port 8080
2025/01/07 12:00:00 Next PDM step scheduled for: 2025-01-08 00:00:00 UTC (sleeping 12h0m0s)
```

### Open the Dashboard

Open your browser and go to:
```
http://localhost:8080
```

You should see the PDM Personal Dashboard.

### Stop the Server

Press `Ctrl+C` in the terminal. You'll see:
```
PDM shutting down gracefully – state saved
```

Your state is automatically saved and will be restored when you restart.

---

## Using the Dashboard

### Dashboard Layout

```
┌─────────────────────────────────────────────────────────────┐
│         PDM Personal Dashboard — My Resource Pool           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌──────────┐  ┌──────────┐  ┌──────────────────┐         │
│   │Current S │  │ L Ratio  │  │      Status      │         │
│   │ 618,000  │  │  0.6180  │  │   ● STABLE       │         │
│   │  units   │  │          │  │                  │         │
│   └──────────┘  └──────────┘  └──────────────────┘         │
│                                                             │
│   ─────────────────────────────────────────────────────    │
│   │                    ══════════                    │ 0.62│
│   │                ════════════════                  │ φ   │
│   │            ════════════════════════              │ 0.60│
│   ─────────────────────────────────────────────────────    │
│                                                             │
│   Last updated: 2025-01-07 00:00:00 UTC                    │
│   Next step: 2025-01-08 00:00:00 UTC                       │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ Today's Telemetry                                   │  │
│   │ Oi: [__________]  V: [__________]  [Submit]         │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Understanding the Metrics

| Metric | What It Means |
|--------|---------------|
| **Current S** | Current supply in the pool |
| **L Ratio** | Supply ÷ Outstanding (S ÷ Oi) |
| **Status** | Where L sits relative to the target band |

### Status Indicators

| Status | Color | Meaning |
|--------|-------|---------|
| **STABLE** | Green | L is within the band (0.60–0.62) — equilibrium |
| **LOW** | Yellow | L < 0.60 — supply is low relative to demand |
| **HIGH** | Red | L > 0.62 — supply is high relative to demand |
| **WAITING** | Grey | No data yet |

### The Chart

The chart shows your L ratio history:
- **Blue line** — Your actual L ratio over time
- **Gold line** — φ target (0.618)
- **Green dashed lines** — Stability band (0.60–0.62)

A healthy system stays between the green lines, oscillating around the gold line.

---

## Telemetry Modes

### Manual Mode

**Best for:** Testing, learning, small-scale use

**How to submit data:**

**Option 1: Dashboard**
1. Open the dashboard
2. Enter today's Oi (outstanding/demand) value
3. Enter today's V (volume/velocity) value
4. Click Submit

**Option 2: API**
```bash
curl -X POST http://localhost:8080/api/telemetry \
  -H "Content-Type: application/json" \
  # Optional: if telemetry.auth_token is set in config.yaml
  # -H "X-PDM-Token: <your_token>" \
  -d '{"oi": 1000000, "v": 50000}'
```

**Response:**
```json
{
  "status": "received",
  "oi": 1000000,
  "v": 50000,
  "timestamp": "2025-01-07T12:00:00Z"
}
```

### CSV Mode

**Best for:** Batch data, spreadsheet imports, historical analysis

**Step 1: Create your telemetry CSV**

Create `data/telemetry.csv`:
```csv
date,oi,v
2025-01-01,1000000,50000
2025-01-02,1020000,55000
2025-01-03,1015000,48000
2025-01-04,1030000,62000
2025-01-05,1025000,51000
```

**Format:**
- `date` — YYYY-MM-DD format
- `oi` — Outstanding/demand value for that day
- `v` — Volume/velocity for that day

**Step 2: Set mode in config.yaml**
```yaml
telemetry:
  mode: "csv"
  csv_path: "./data/telemetry.csv"
```

**How it works:**
- At each scheduled step, PDM reads the CSV
- It looks for a row matching today's date
- If found, it uses those values
- If not found, you'll see a warning in the logs

### Webhook Mode

**Best for:** Automation, external system integration

**How it works:**
- External systems POST to `/api/telemetry`
- PDM stores the latest values
- At the scheduled step time, it uses whatever was last received

**Example integration (Node.js):**
```javascript
const axios = require('axios');

async function sendTelemetry(oi, v) {
  await axios.post('http://localhost:8080/api/telemetry', {
    oi: oi,
    v: v
  });
}

// Send daily at 23:00 before the midnight step
sendTelemetry(1000000, 50000);
```

---

## API Reference

### GET /pdm/v1/state

Returns current state and history.

**Request:**
```bash
curl http://localhost:8080/pdm/v1/state
```

**Response:**
```json
{
  "s_current": 618000,
  "m_cap": 1000000,
  "latest_trace": {
    "timestamp": "2025-01-07T00:00:00Z",
    "s_prev": 620000,
    "o_i": 1000000,
    "v_total": 50000,
    "l": 0.618,
    "s_new": 618000,
    "hash_chain_root": "a1b2c3..."
  },
  "history": [...]
}
```

### GET /pdm/v1/config

Returns pool configuration.

**Request:**
```bash
curl http://localhost:8080/pdm/v1/config
```

**Response:**
```json
{
  "pool_name": "My Resource Pool",
  "unit": "units",
  "show_history_days": 30
}
```

### GET /pdm/v1/health

Health check endpoint.

**Request:**
```bash
curl http://localhost:8080/pdm/v1/health
```

**Response:**
```json
{"status": "ok"}
```

### POST /api/telemetry

Submit telemetry values (manual/webhook modes only).

**Request:**
```bash
curl -X POST http://localhost:8080/api/telemetry \
  -H "Content-Type: application/json" \
  -d '{"oi": 1000000, "v": 50000}'
```

**Response:**
```json
{
  "status": "received",
  "oi": 1000000,
  "v": 50000,
  "timestamp": "2025-01-07T12:00:00Z"
}
```

**Validation:**
- `oi` must be > 0
- `v` must be >= 0

---

## Understanding the Output

### Log Output

When a PDM step runs, you'll see:
```
2025/01/07 00:00:00 Next PDM step scheduled for: 2025-01-08 00:00:00 UTC (sleeping 24h0m0s)
2025/01/07 00:00:00 PDM step completed → L=0.6180  S=618000.00
```

If telemetry is missing:
```
2025/01/07 00:00:00 WARNING: Oi is zero or missing — PDM step will use MinO fallback
2025/01/07 00:00:00 WARNING: V is zero — no burn will occur this step
```

### History CSV

Every step is logged to `data/history.csv`:
```csv
timestamp,oi,v_total,s_prev,s_new,l_ratio,clamped_s,clamped_cap,error
2025-01-07 00:00:00,1000000.000000,50000.000000,620000.000000,618000.000000,0.6180,false,false,
```

### State JSON

Full state is persisted to `data/state.json`:
```json
{
  "S": 618000,
  "MCap": 1000000,
  "Config": {
    "phi_target": 0.618,
    "band_low": 0.6,
    "band_high": 0.62,
    ...
  },
  "history": [...]
}
```

---

## Common Use Cases

### Use Case 1: Learning PDM Mechanics

**Goal:** Understand how the system responds to different inputs

**Setup:**
```yaml
pool:
  name: "Learning Pool"
  mcap: 1000
  initial_s: 618

telemetry:
  mode: "manual"

schedule:
  run_time: "00:00"
  timezone: "UTC"
```

**Experiment:**
1. Start with Oi=1000, V=100 (balanced)
2. Try high activity (V): Oi=1000, V=500 (watch S decrease)
3. Try low Oi: Oi=500, V=100 (watch L change)

### Use Case 2: Inventory Management Simulation

**Goal:** Model stock levels against demand

**Setup:**
```yaml
pool:
  name: "Warehouse Stock"
  mcap: 10000            # Max storage capacity
  initial_s: 6180        # Current stock

resource:
  unit: "units"

telemetry:
  mode: "csv"
  csv_path: "./data/daily_orders.csv"
```

**CSV format:**
```csv
date,oi,v
2025-01-07,8000,500
```
- `oi` = total outstanding orders
- `v` = units shipped today

### Use Case 3: Community Token Dashboard

**Goal:** Visual monitoring of a community token pool

**Setup:**
```yaml
pool:
  name: "Community Credits"
  mcap: 1000000
  initial_s: 618000

resource:
  unit: "credits"

telemetry:
  mode: "webhook"

dashboard:
  port: 3000
  show_history_days: 90
```

**Integration:** Your token contract or backend POSTs daily stats to the webhook.

---

## Troubleshooting

### "Config error: YAML parse error"

**Problem:** Your config.yaml has a syntax error.

**Fix:**
- Check indentation (YAML uses spaces, not tabs)
- Ensure colons have a space after them
- Validate at [yamllint.com](http://www.yamllint.com/)

### "Config error: pool.mcap must be > 0"

**Problem:** MCap is missing or set to zero/negative.

**Fix:** Ensure `pool.mcap` is a positive number:
```yaml
pool:
  mcap: 1000000
```

### "Config error: schedule.timezone is invalid"

**Problem:** Unrecognised timezone string.

**Fix:** Use a valid IANA timezone:
```yaml
schedule:
  timezone: "Europe/London"  # Not "BST" or "GMT+1"
```

### "WARNING: Oi is zero or missing"

**Problem:** No telemetry submitted before the step ran.

**Fix (manual mode):** Submit values before the scheduled time:
```bash
curl -X POST http://localhost:8080/api/telemetry \
  -H "Content-Type: application/json" \
  -d '{"oi": 1000000, "v": 50000}'
```

**Fix (CSV mode):** Ensure your CSV has a row for today's date.

### Port already in use

**Problem:** Another application is using the configured port.

**Fix:** Change the port in config.yaml:
```yaml
dashboard:
  port: 3000  # Try a different port
```

### State not persisting

**Problem:** Changes lost after restart.

**Check:**
1. Is the `data/` directory writable?
2. Did you stop the server with Ctrl+C (graceful) or kill -9 (forced)?
3. Check for `data/state.json` — it should exist after first run.

### Dashboard shows "Waiting for first data..."

**Problem:** No PDM steps have run yet.

**This is normal on first run.** Either:
1. Wait for the scheduled time
2. Or manually trigger by submitting telemetry and waiting

---

## How PDM Works (Simplified)

### The Core Idea

PDM maintains balance using a simple feedback loop:

```
                    ┌─────────────────┐
                    │   φ = 0.618     │ ← Target ratio
                    │  (golden ratio) │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
    L < 0.60            0.60 ≤ L ≤ 0.62      L > 0.62
   (too low)              (stable)           (too high)
         │                   │                   │
         ▼                   ▼                   ▼
   MINT supply         DO NOTHING          BURN only
  (add to pool)       (equilibrium)      (no minting)
```

### The Math (Simplified)

Each daily step:

1. **Calculate velocity:** `velocity = V / S`
2. **Calculate burn:** `burn = base_rate × (1 - k × deviation) × V`
3. **Apply burn:** `S_temp = S - burn`
4. **Calculate L:** `L = S_temp / Oi`
5. **Mint if needed:** If L < 0.60, mint to restore balance
6. **Update S:** `S_new = S_temp + mint`

### Why φ (Phi)?

The golden ratio (≈ 0.618) appears throughout nature as a point of balance:
- Spiral patterns in shells and galaxies
- Branching in trees and blood vessels
- Proportions in art and architecture

In PDM, it represents the optimal ratio of supply to demand — not too scarce, not too abundant.

### The Hash Chain

Every step produces a `hash_chain_root`, a cryptographic hash that chains to the previous step.

The current `hash_chain_root` value is included in the `/pdm/v1/state` response under `latest_trace.hash_chain_root` and in each item of `history`.

```
Step 1 → hash_1
Step 2 → hash(hash_1 + step_2_data) → hash_2
Step 3 → hash(hash_2 + step_3_data) → hash_3
```

This creates an **immutable audit trail**. Any tampering with historical data would break the chain.

---

## Next Steps

1. **Experiment:** Try different Oi and V values, watch how S responds
2. **Visualise:** Let it run for a week, observe the chart patterns
3. **Integrate:** Connect it to real data via CSV or webhook
4. **Learn more:** Read the original PDM whitepaper (if available)

---

## Getting Help

- **Technical issues:** Open a GitHub issue
- **PDM concepts:** Contact Mann Mechanics
- **Licensing questions:** See README.md for certification guidance

---

## Version History

| Version | Date | Notes |
|---------|------|-------|
| 1.0.0 | January 2025 | Initial release |

---

*PDM Personal Edition is provided as-is for educational and community use. See LICENSE for terms.*
