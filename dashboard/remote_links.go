package main

import (
	"context"
	"encoding/json"
	"net/netip"
	"os"
	"os/exec"
	"os/user"
	"strings"
	"time"
)

// Discover once at startup, never while rendering or navigating a report.
func discoverViewerRemoteAddress() (sshHost, bindIP, dnsName string) {
	override := strings.TrimSpace(os.Getenv("CAREER_OPS_SSH_HOST"))
	if override == "local" {
		return "", "", ""
	}
	account, err := user.Current()
	if err != nil {
		return "", "", ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	status, err := exec.CommandContext(ctx, "tailscale", "status", "--json").Output()
	if err != nil {
		return "", "", ""
	}
	return viewerRemoteAddress(override, account.Username, status)
}

func viewerRemoteAddress(override, username string, status []byte) (sshHost, bindIP, dnsName string) {
	var state struct {
		Self struct {
			DNSName      string
			TailscaleIPs []string
		}
	}
	if json.Unmarshal(status, &state) != nil || override == "local" {
		return "", "", ""
	}
	dnsName = strings.TrimSuffix(strings.TrimSpace(state.Self.DNSName), ".")
	if dnsName == "" || strings.ContainsAny(dnsName, "/\\:@?# \t\r\n") {
		return "", "", ""
	}
	for _, value := range state.Self.TailscaleIPs {
		ip, err := netip.ParseAddr(value)
		if err == nil && isTailnetAddress(ip) {
			return viewerSSHHost(override, username, status), ip.String(), dnsName
		}
	}
	return "", "", ""
}

func isTailnetAddress(ip netip.Addr) bool {
	return netip.MustParsePrefix("100.64.0.0/10").Contains(ip) || netip.MustParsePrefix("fd7a:115c:a1e0::/48").Contains(ip)
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
