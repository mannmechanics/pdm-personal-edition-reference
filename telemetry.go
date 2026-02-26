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

// pdm-personal/telemetry.go
// Telemetry sources for PDM Personal Edition

package main

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

var manualTelemetry ManualTelemetry
var csvTelemetry CSVTelemetry
var webhookTelemetry WebhookTelemetry

type TelemetrySource interface {
	FetchOi() (float64, error)
	FetchV() (float64, error)
}

func todayYYYYMMDD() string {
	// Use configured schedule timezone if available; fall back to UTC.
	if cfgFile != nil && cfgFile.Schedule.Timezone != "" {
		if loc, err := time.LoadLocation(cfgFile.Schedule.Timezone); err == nil {
			return time.Now().In(loc).Format("2006-01-02")
		}
	}
	return time.Now().UTC().Format("2006-01-02")
}

// ── Manual Telemetry ───────────────────────────────────────────────────

type ManualTelemetry struct {
	latestOi float64
	latestV  float64
	mu       sync.RWMutex
}

func (m *ManualTelemetry) FetchOi() (float64, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.latestOi, nil
}

func (m *ManualTelemetry) FetchV() (float64, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.latestV, nil
}

// ── CSV Telemetry ──────────────────────────────────────────────────────

type CSVTelemetry struct {
	csvPath string
}

// FetchToday reads the CSV once and returns both Oi and V for "today".
func (c *CSVTelemetry) FetchToday() (float64, float64, error) {
	f, err := os.Open(c.csvPath)
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()

	reader := csv.NewReader(f)
	records, err := reader.ReadAll()
	if err != nil {
		return 0, 0, err
	}
	if len(records) < 2 {
		return 0, 0, fmt.Errorf("CSV needs header + data")
	}

	today := todayYYYYMMDD()

	// Allow minor CSV formatting issues (whitespace, BOM) and tolerate common date formats.
	matchDate := func(raw string) bool {
		ds := strings.TrimSpace(raw)
		ds = strings.TrimPrefix(ds, "\ufeff") // handle UTF-8 BOM if present
		if ds == today {
			return true
		}
		layouts := []string{"2006-01-02", "2006/01/02"}
		for _, layout := range layouts {
			if t, err := time.Parse(layout, ds); err == nil {
				if t.Format("2006-01-02") == today {
					return true
				}
			}
		}
		return false
	}

	for _, row := range records[1:] {
		if len(row) < 3 {
			continue
		}
		if !matchDate(row[0]) {
			continue
		}

		oi, err := strconv.ParseFloat(strings.TrimSpace(row[1]), 64)
		if err != nil {
			return 0, 0, fmt.Errorf("CSV Oi parse error: %v", err)
		}
		v, err := strconv.ParseFloat(strings.TrimSpace(row[2]), 64)
		if err != nil {
			return 0, 0, fmt.Errorf("CSV V parse error: %v", err)
		}

		// Enforce the same constraints as the POST endpoint for parity across telemetry modes.
		if oi <= 0 {
			return 0, 0, fmt.Errorf("CSV Oi must be > 0")
		}
		if v < 0 {
			return 0, 0, fmt.Errorf("CSV V must be >= 0")
		}

		return oi, v, nil
	}
	return 0, 0, fmt.Errorf("no data for today (%s)", today)
}

func (c *CSVTelemetry) FetchOi() (float64, error) {
	oi, _, err := c.FetchToday()
	return oi, err
}

func (c *CSVTelemetry) FetchV() (float64, error) {
	_, v, err := c.FetchToday()
	return v, err
}

// ── Webhook Telemetry ──────────────────────────────────────────────────

type WebhookTelemetry struct {
	latestOi float64
	latestV  float64
	mu       sync.RWMutex
}

func (w *WebhookTelemetry) FetchOi() (float64, error) {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return w.latestOi, nil
}

func (w *WebhookTelemetry) FetchV() (float64, error) {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return w.latestV, nil
}

func (w *WebhookTelemetry) Update(oi, v float64) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.latestOi = oi
	w.latestV = v
}

// ── HTTP Handler ───────────────────────────────────────────────────────

// telemetryHandler accepts POST requests to update telemetry (manual/webhook modes)
func telemetryHandler(w http.ResponseWriter, r *http.Request) {
	// Optional shared-secret auth (recommended if server is network-exposed)
	if cfgFile != nil && cfgFile.Telemetry.AuthToken != "" {
		tok := r.Header.Get("X-PDM-Token")
		if tok == "" {
			// allow Authorization: Bearer <token>
			const pfx = "Bearer "
			authz := r.Header.Get("Authorization")
			if len(authz) > len(pfx) && authz[:len(pfx)] == pfx {
				tok = authz[len(pfx):]
			}
		}
		if tok != cfgFile.Telemetry.AuthToken {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
	}

	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "only POST allowed")
		return
	}

	if telemetryMode == "csv" {
		writeJSONError(w, http.StatusMethodNotAllowed, "POST disabled in csv mode")
		return
	}

	// Limit request body size (the payload is tiny). Helps avoid resource exhaustion if exposed on a network.
	r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		// If MaxBytesReader is tripped, the error string typically contains "request body too large".
		if strings.Contains(err.Error(), "request body too large") {
			writeJSONError(w, http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		writeJSONError(w, http.StatusBadRequest, "failed to read request body")
		return
	}

	var input struct {
		Oi float64 `json:"oi"`
		V  float64 `json:"v"`
	}
	if err := json.Unmarshal(body, &input); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	if input.Oi <= 0 {
		writeJSONError(w, http.StatusBadRequest, "Oi must be > 0")
		return
	}
	if input.V < 0 {
		writeJSONError(w, http.StatusBadRequest, "V must be >= 0")
		return
	}

	switch telemetryMode {
	case "manual":
		manualTelemetry.mu.Lock()
		manualTelemetry.latestOi = input.Oi
		manualTelemetry.latestV = input.V
		manualTelemetry.mu.Unlock()
	case "webhook":
		webhookTelemetry.Update(input.Oi, input.V)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":    "received",
		"oi":        input.Oi,
		"v":         input.V,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
