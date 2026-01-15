/*
Progressive Depletion Minting (PDM)
Reference Implementation – Personal Edition

Author: Valraj Singh Mann
Framework: Mann Mechanics

This file forms part of a reference implementation of
Progressive Depletion Minting (PDM).

This code is provided for educational, research, and
non-commercial demonstration purposes only.

Commercial use, production deployment, or claims of
certification or compliance are prohibited without
explicit written licence from the rights holder.

Patent protections may apply regardless of software licence.

Provided "AS IS" without warranty of any kind.
*/

// pdm-personal/main.go
// MannCert PDM Personal Edition v1.0.0
// Integrates existing PDM core with personal config, telemetry, and dashboard
// Core PDM logic (StepPDM, etc.) is unchanged and patent-locked

package main

import (
	"crypto/sha256"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// ── Existing PDM Core (Unchanged) ──────────────────────────────────────

type PDMConfig struct {
	PhiTarget     float64 `json:"phi_target"`
	BandLow       float64 `json:"band_low"`
	BandHigh      float64 `json:"band_high"`
	BurnBase      float64 `json:"burn_base"`
	BurnVelocityK float64 `json:"burn_velocity_k"`
	MinS          float64 `json:"min_s"`
	MinO          float64 `json:"min_o"`
}

func DefaultConfig(mcap float64) PDMConfig {
	return PDMConfig{
		PhiTarget:     0.618,
		BandLow:       0.60,
		BandHigh:      0.62,
		BurnBase:      0.000618,
		BurnVelocityK: 0.1,
		MinS:          1e-9 * mcap,
		MinO:          1e-6,
	}
}

type StepTrace struct {
	Timestamp     time.Time `json:"timestamp"`
	SPrev         float64   `json:"s_prev"`
	Oi            float64   `json:"o_i"`
	VTotal        float64   `json:"v_total"`
	MCap          float64   `json:"m_cap"`
	PhiTarget     float64   `json:"phi_target"`
	BandLow       float64   `json:"band_low"`
	BandHigh      float64   `json:"band_high"`
	BurnBase      float64   `json:"burn_base"`
	BurnVelocityK float64   `json:"burn_velocity_k"`

	Velocity   float64 `json:"velocity"`
	BurnRate   float64 `json:"burn_rate"`
	BurnAmount float64 `json:"burn_amount"`
	STemp      float64 `json:"s_temp"`
	L          float64 `json:"l"`
	MintRaw    float64 `json:"mint_raw"`
	MintDamped float64 `json:"mint_damped"`
	Delta      float64 `json:"delta"`
	SNew       float64 `json:"s_new"`

	ClampedS   bool   `json:"clamped_s"`
	ClampedCap bool   `json:"clamped_cap"`
	Error         string `json:"error,omitempty"`
	HashChainRoot string `json:"hash_chain_root"`
}

func StepPDM(sPrev, oi, vtotal, mcap float64, prevHashChainRoot string, cfg PDMConfig) (float64, StepTrace) {
	trace := StepTrace{
		Timestamp:     time.Now().UTC(),
		SPrev:         sPrev,
		Oi:            oi,
		VTotal:        vtotal,
		MCap:          mcap,
		PhiTarget:     cfg.PhiTarget,
		BandLow:       cfg.BandLow,
		BandHigh:      cfg.BandHigh,
		BurnBase:      cfg.BurnBase,
		BurnVelocityK: cfg.BurnVelocityK,
	}

	if mcap <= 0 {
		trace.Error = "M_cap must be > 0"
		return sPrev, trace
	}
	if oi < cfg.MinO {
		oi = cfg.MinO
		trace.Oi = oi
	}
	sSafe := math.Max(sPrev, cfg.MinS)

	velocity := vtotal / sSafe
	deviation := velocity - cfg.PhiTarget
	burnRate := 1.0 - cfg.BurnVelocityK*deviation
	if burnRate < 0 {
		burnRate = 0
	}
	burnAmount := cfg.BurnBase * burnRate * vtotal
	sTemp := sPrev - burnAmount

	if sTemp < 0 {
		trace.ClampedS = true
		sTemp = 0
	}

	trace.Velocity = velocity
	trace.BurnRate = burnRate
	trace.BurnAmount = burnAmount
	trace.STemp = sTemp

	l := sTemp / oi
	trace.L = l

	var delta float64
	if l < cfg.BandLow {
		mintRaw := cfg.PhiTarget*oi - sTemp
		damping := math.Pow(cfg.PhiTarget, sTemp/mcap)
		delta = mintRaw * damping
		trace.MintRaw = mintRaw
		trace.MintDamped = delta
	} else if l >= cfg.BandHigh {
		delta = 0
	}

	sNew := sTemp + delta
	if sNew > mcap {
		trace.ClampedCap = true
		delta = mcap - sTemp
		sNew = mcap
	}

	trace.Delta = delta
	trace.SNew = sNew

	// Audit hash chain (chained SHA256: previous hash + trace JSON)
	traceJSON, _ := json.Marshal(trace)
	h := sha256.New()
	h.Write([]byte(prevHashChainRoot + string(traceJSON)))
	trace.HashChainRoot = fmt.Sprintf("%x", h.Sum(nil))

	return sNew, trace
}

type PoolState struct {
	S       float64
	MCap    float64
	Config  PDMConfig
	History []StepTrace `json:"history"`
}

var (
	state       PoolState
	stateMu     sync.RWMutex
	stateLoaded bool
)

const dataDir = "./data"

func init() {
	os.MkdirAll(dataDir, 0755)
	loadState()
}

func persist(trace StepTrace) {
	stateMu.Lock()
	state.History = append(state.History, trace)
	if len(state.History) > 365 {
		state.History = state.History[len(state.History)-365:]
	}
	stateMu.Unlock()

	// CSV append with header detection
	csvPath := dataDir + "/history.csv"
	writeHeader := false

	// Check if file exists and has content
	if info, err := os.Stat(csvPath); os.IsNotExist(err) || (err == nil && info.Size() == 0) {
		writeHeader = true
	}

	f, err := os.OpenFile(csvPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		log.Printf("CSV persist error: %v", err)
	} else {
		defer f.Close()
		writer := csv.NewWriter(f)

		// Write header on first write
		if writeHeader {
			writer.Write([]string{
				"timestamp", "oi", "v_total", "s_prev", "s_new", "l_ratio", "clamped_s", "clamped_cap", "error",
			})
		}

		writer.Write([]string{
			trace.Timestamp.Format("2006-01-02 15:04:05"),
			strconv.FormatFloat(trace.Oi, 'f', 6, 64),
			strconv.FormatFloat(trace.VTotal, 'f', 6, 64),
			strconv.FormatFloat(trace.SPrev, 'f', 6, 64),
			strconv.FormatFloat(trace.SNew, 'f', 6, 64),
			strconv.FormatFloat(trace.L, 'f', 4, 64),
			fmt.Sprintf("%t", trace.ClampedS),
			fmt.Sprintf("%t", trace.ClampedCap),
			trace.Error,
		})
		writer.Flush()
		if err := writer.Error(); err != nil {
			log.Printf("CSV writer error: %v", err)
		}
	}

	// Atomic state JSON save (temp + rename)
	stateMu.RLock()
	stateJSON, _ := json.Marshal(state)
	stateMu.RUnlock()
	tmpFile := dataDir + "/state.json.tmp"
	if err := os.WriteFile(tmpFile, stateJSON, 0644); err != nil {
		log.Printf("State JSON temp write error: %v", err)
		return
	}
	if err := os.Rename(tmpFile, dataDir+"/state.json"); err != nil {
		log.Printf("State JSON rename error: %v", err)
	}
}

func loadState() {
	stateMu.Lock()
	defer stateMu.Unlock()
	data, err := os.ReadFile(dataDir + "/state.json")
	if err == nil {
		if json.Unmarshal(data, &state) == nil {
			stateLoaded = true
			log.Printf("Loaded state: S=%.2f, History=%d entries", state.S, len(state.History))
			return
		}
	}
	// No state – bootstrap in main()
	log.Println("No existing state – will bootstrap from config")
}

var healthy int32 = 1

func stateHandler(w http.ResponseWriter, r *http.Request) {
	stateMu.RLock()
	defer stateMu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(struct {
		S       float64     `json:"s_current"`
		MCap    float64     `json:"m_cap"`
		Latest  StepTrace   `json:"latest_trace,omitempty"`
		History []StepTrace `json:"history,omitempty"`
	}{
		S:    state.S,
		MCap: state.MCap,
		Latest: func() StepTrace {
			if len(state.History) > 0 {
				return state.History[len(state.History)-1]
			}
			return StepTrace{}
		}(),
		History: state.History,
	})
}

func configHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"pool_name":         cfgFile.Pool.Name,
		"unit":              cfgFile.Resource.Unit,
		"show_history_days": cfgFile.Dashboard.ShowHistoryDays,
		"schedule_run_time": cfgFile.Schedule.RunTime,
		"schedule_timezone": cfgFile.Schedule.Timezone,
		"telemetry_auth_required": cfgFile.Telemetry.AuthToken != "",
	})
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	if atomic.LoadInt32(&healthy) == 1 {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	} else {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "shutting_down"})
	}
}

var telemetryMode string

// fetchTelemetryValues returns (Oi, V) for the current mode.
// In CSV mode, it reads the file once per step.
func fetchTelemetryValues() (float64, float64) {
	switch telemetryMode {
	case "manual":
		oi, _ := manualTelemetry.FetchOi()
		v, _ := manualTelemetry.FetchV()
		return oi, v
	case "csv":
		oi, v, _ := csvTelemetry.FetchToday()
		return oi, v
	case "webhook":
		oi, _ := webhookTelemetry.FetchOi()
		v, _ := webhookTelemetry.FetchV()
		return oi, v
	default:
		return 0, 0
	}
}

// calculateNextRun computes the next scheduled run time based on config
func calculateNextRun(cfg *ConfigFile) time.Time {
	// Load timezone
	loc, err := time.LoadLocation(cfg.Schedule.Timezone)
	if err != nil {
		log.Printf("Invalid timezone '%s', defaulting to UTC: %v", cfg.Schedule.Timezone, err)
		loc = time.UTC
	}

	// Parse run time
	runTimeParts, err := time.Parse("15:04", cfg.Schedule.RunTime)
	if err != nil {
		log.Printf("Invalid run_time '%s', defaulting to 00:00: %v", cfg.Schedule.RunTime, err)
		runTimeParts, _ = time.Parse("15:04", "00:00")
	}

	now := time.Now().In(loc)
	next := time.Date(
		now.Year(), now.Month(), now.Day(),
		runTimeParts.Hour(), runTimeParts.Minute(), 0, 0,
		loc,
	)

	// If the scheduled time has already passed today, schedule for tomorrow
	if now.After(next) {
		next = next.AddDate(0, 0, 1)
	}

	return next
}

func dailyRunner() {
	prevRoot := ""
	if stateLoaded && len(state.History) > 0 {
		prevRoot = state.History[len(state.History)-1].HashChainRoot
	}

	for {
		next := calculateNextRun(cfgFile)
		sleepDuration := time.Until(next)
		log.Printf("Next PDM step scheduled for: %s (sleeping %v)", next.Format("2006-01-02 15:04:05 MST"), sleepDuration.Round(time.Minute))
		time.Sleep(sleepDuration)

		oi, vtotal := fetchTelemetryValues()

		// Observability: warn if telemetry is missing or zero
		if oi == 0 {
			log.Printf("WARNING: Oi is zero or missing — PDM step will use MinO fallback")
		}
		if vtotal == 0 {
			log.Printf("WARNING: V is zero — no burn will occur this step")
		}

		stateMu.Lock()
		newS, trace := StepPDM(state.S, oi, vtotal, state.MCap, prevRoot, state.Config)
		state.S = newS
		prevRoot = trace.HashChainRoot
		stateMu.Unlock()

		persist(trace)
		log.Printf("PDM step completed → L=%.4f  S=%.2f", trace.L, newS)
	}
}

func main() {
	atomic.StoreInt32(&healthy, 1)

	// Load user config
	var err error
	cfgFile, err = LoadConfig()
	if err != nil {
		log.Fatalf("Config error: %v", err)
	}

	telemetryMode = cfgFile.Telemetry.Mode
	csvTelemetry.csvPath = cfgFile.Telemetry.CSVPath

	// Bootstrap only if no state loaded
	if !stateLoaded {
		state = PoolState{
			S:      cfgFile.Pool.InitialS,
			MCap:   cfgFile.Pool.MCap,
			Config: DefaultConfig(cfgFile.Pool.MCap),
		}
		log.Println("Bootstrapped from config.yaml")
	}

	http.HandleFunc("/pdm/v1/state", stateHandler)
	http.HandleFunc("/pdm/v1/config", configHandler)
	http.HandleFunc("/pdm/v1/health", healthHandler)
	http.HandleFunc("/api/telemetry", telemetryHandler)
	http.Handle("/", http.FileServer(http.Dir("./web")))

	go dailyRunner()

	// Graceful shutdown
	c := make(chan os.Signal, 1)
	signal.Notify(c, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-c
		atomic.StoreInt32(&healthy, 0)
		// Atomic shutdown save
		tmpFile := dataDir + "/state.json.tmp"
		stateMu.RLock()
		stateJSON, _ := json.Marshal(state)
		stateMu.RUnlock()
		if err := os.WriteFile(tmpFile, stateJSON, 0644); err != nil {
			log.Printf("Shutdown state temp write error: %v", err)
			return
		}
		if err := os.Rename(tmpFile, dataDir+"/state.json"); err != nil {
			log.Printf("Shutdown state rename error: %v", err)
		}
		log.Println("PDM shutting down gracefully – state saved")
		os.Exit(0)
	}()

	log.Printf("PDM Personal Edition starting on port %d", cfgFile.Dashboard.Port)
	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfgFile.Dashboard.Port),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Fatal(srv.ListenAndServe())
}

// Patent Notice and Disclaimer
// Certain mechanisms and methods related to Progressive Depletion Minting (PDM)
// are protected by patents held by Valraj Singh Mann under the Mann Mechanics framework.
//
// Licensing Notice
// This repository is released under the terms in LICENSE.txt (PDM Personal Edition License).
// No patent rights are granted by access to or use of this code.
// Commercial use or production deployment may require a separate written licence from the rights holder
//
// No patent rights are granted under this License.
// Any implementation that practices patented PDM mechanisms, as defined in
// applicable patent claims, may require a separate patent license and/or
// certification from Mann Mechanics / MannCert.
//
// This implementation does not create money, does not set prices, and does not
// intermediate transactions. It operates solely as a local, auditable system
// control mechanism.
