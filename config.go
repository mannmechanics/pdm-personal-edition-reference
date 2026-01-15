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

// pdm-personal/config.go
// Load and validate config.yaml

package main

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

var cfgFile *ConfigFile

type ConfigFile struct {
	Pool      PoolConfig      `yaml:"pool"`
	Resource  ResourceConfig  `yaml:"resource"`
	Telemetry TelemetryConfig `yaml:"telemetry"`
	Schedule  ScheduleConfig  `yaml:"schedule"`
	Dashboard DashboardConfig `yaml:"dashboard"`
	Alerts    AlertsConfig    `yaml:"alerts"`
}

type PoolConfig struct {
	Name     string  `yaml:"name"`
	MCap     float64 `yaml:"mcap"`
	InitialS float64 `yaml:"initial_s"`
}

type ResourceConfig struct {
	Unit string `yaml:"unit"`
}

type TelemetryConfig struct {
	Mode      string `yaml:"mode"`
	CSVPath   string `yaml:"csv_path"`
	AuthToken string `yaml:"auth_token"`
}

type ScheduleConfig struct {
	RunTime  string `yaml:"run_time"`
	Timezone string `yaml:"timezone"`
}

type DashboardConfig struct {
	Port            int `yaml:"port"`
	ShowHistoryDays int `yaml:"show_history_days"`
}

type AlertsConfig struct {
	Enabled    bool   `yaml:"enabled"`
	WebhookURL string `yaml:"webhook_url"`
}

func LoadConfig() (*ConfigFile, error) {
	data, err := os.ReadFile("config.yaml")
	if err != nil {
		data, err = os.ReadFile("/etc/pdm/config.yaml")
		if err != nil {
			if copyErr := copyExample(); copyErr != nil {
				return nil, fmt.Errorf("no config.yaml found and failed to copy example: %v", copyErr)
			}
			data, err = os.ReadFile("config.yaml")
			if err != nil {
				return nil, fmt.Errorf("failed to read config.yaml after copy: %v", err)
			}
		}
	}

	var cfg ConfigFile
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("YAML parse error: %v", err)
	}

	if err := ValidateConfig(&cfg); err != nil {
		return nil, err
	}

	log.Printf("Loaded config: Pool=%s, Mode=%s, Port=%d", cfg.Pool.Name, cfg.Telemetry.Mode, cfg.Dashboard.Port)
	return &cfg, nil
}

func copyExample() error {
	data, err := os.ReadFile("config.yaml.example")
	if err != nil {
		return fmt.Errorf("config.yaml.example not found: %v", err)
	}
	if err := os.WriteFile("config.yaml", data, 0644); err != nil {
		return fmt.Errorf("failed to write config.yaml: %v", err)
	}
	log.Println("Copied config.yaml.example to config.yaml - please edit")
	return nil
}

func ValidateConfig(cfg *ConfigFile) error {
	if cfg.Pool.MCap <= 0 {
		return fmt.Errorf("pool.mcap must be > 0")
	}
	if cfg.Pool.InitialS < 0 || cfg.Pool.InitialS > cfg.Pool.MCap {
		return fmt.Errorf("pool.initial_s must be [0, mcap]")
	}

	validModes := map[string]bool{"manual": true, "csv": true, "webhook": true}
	if !validModes[cfg.Telemetry.Mode] {
		return fmt.Errorf("telemetry.mode must be 'manual', 'csv', or 'webhook'")
	}

	if cfg.Telemetry.Mode == "csv" {
		if strings.TrimSpace(cfg.Telemetry.CSVPath) == "" {
			return fmt.Errorf("telemetry.csv_path is required when telemetry.mode is csv")
		}
	}

	if _, err := time.Parse("15:04", cfg.Schedule.RunTime); err != nil {
		return fmt.Errorf("schedule.run_time must be HH:MM format")
	}

	// Validate timezone
	if _, err := time.LoadLocation(cfg.Schedule.Timezone); err != nil {
		return fmt.Errorf("schedule.timezone is invalid: %v", err)
	}

	if cfg.Dashboard.Port < 1024 || cfg.Dashboard.Port > 65535 {
		return fmt.Errorf("dashboard.port must be 1024-65535")
	}

	if cfg.Dashboard.ShowHistoryDays <= 0 {
		cfg.Dashboard.ShowHistoryDays = 30 // Default
	}

	return nil
}
