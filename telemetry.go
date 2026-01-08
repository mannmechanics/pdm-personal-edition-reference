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

func (c *CSVTelemetry) FetchOi() (float64, error) {
	f, err := os.Open(c.csvPath)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	reader := csv.NewReader(f)
	records, err := reader.ReadAll()
	if err != nil {
		return 0, err
	}

	if len(records) < 2 {
		return 0, fmt.Errorf("CSV needs header + data")
	}

	today := time.Now().UTC().Format("2006-01-02")
	for _, row := range records[1:] {
		if len(row) >= 3 && row[0] == today {
			oi, err := strconv.ParseFloat(row[1], 64)
			if err != nil {
				return 0, fmt.Errorf("CSV Oi parse error: %v", err)
			}
			return oi, nil
		}
	}
	return 0, fmt.Errorf("no data for today (%s)", today)
}

func (c *CSVTelemetry) FetchV() (float64, error) {
	f, err := os.Open(c.csvPath)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	reader := csv.NewReader(f)
	records, err := reader.ReadAll()
	if err != nil {
		return 0, err
	}

	if len(records) < 2 {
		return 0, fmt.Errorf("CSV needs header + data")
	}

	today := time.Now().UTC().Format("2006-01-02")
	for _, row := range records[1:] {
		if len(row) >= 3 && row[0] == today {
			v, err := strconv.ParseFloat(row[2], 64)
			if err != nil {
				return 0, fmt.Errorf("CSV V parse error: %v", err)
			}
			return v, nil
		}
	}
	return 0, fmt.Errorf("no data for today (%s)", today)
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
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Only POST allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	if telemetryMode == "csv" {
		http.Error(w, `{"error":"POST disabled in csv mode"}`, http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, `{"error":"Failed to read request body"}`, http.StatusBadRequest)
		return
	}

	var input struct {
		Oi float64 `json:"oi"`
		V  float64 `json:"v"`
	}
	if err := json.Unmarshal(body, &input); err != nil {
		http.Error(w, `{"error":"Invalid JSON"}`, http.StatusBadRequest)
		return
	}

	if input.Oi <= 0 {
		http.Error(w, `{"error":"Oi must be > 0"}`, http.StatusBadRequest)
		return
	}
	if input.V < 0 {
		http.Error(w, `{"error":"V must be >= 0"}`, http.StatusBadRequest)
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "received",
		"oi":        input.Oi,
		"v":         input.V,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}
