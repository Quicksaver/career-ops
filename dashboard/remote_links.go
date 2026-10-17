package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"os/user"
	"strings"
	"time"
)

// Discover once at startup, never while rendering or navigating a report.
func discoverViewerSSHHost() string {
	if override := strings.TrimSpace(os.Getenv("CAREER_OPS_SSH_HOST")); override != "" {
		return viewerSSHHost(override, "", nil)
	}
	account, err := user.Current()
	if err != nil {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	status, err := exec.CommandContext(ctx, "tailscale", "status", "--json").Output()
	if err != nil {
		return ""
	}
	return viewerSSHHost("", account.Username, status)
}

func viewerSSHHost(override, username string, status []byte) string {
	if override == "local" {
		return ""
	}
	if override != "" {
		return override
	}
	var state struct {
		Self struct{ DNSName string }
	}
	if json.Unmarshal(status, &state) != nil {
		return ""
	}
	host := strings.TrimSuffix(strings.TrimSpace(state.Self.DNSName), ".")
	username = username[strings.LastIndexAny(username, `\/`)+1:]
	if host == "" || username == "" {
		return ""
	}
	return username + "@" + host
}
