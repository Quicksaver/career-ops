package main

import (
	"context"
	"encoding/json"
	"net/netip"
	"os/exec"
	"strings"
	"time"
)

// Discover once at startup, never while rendering or navigating a report.
func discoverViewerRemoteAddress() (bindIP, dnsName string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	status, err := exec.CommandContext(ctx, "tailscale", "status", "--json").Output()
	if err != nil {
		return "", ""
	}
	return viewerRemoteAddress(status)
}

func viewerRemoteAddress(status []byte) (bindIP, dnsName string) {
	var state struct {
		Self struct {
			DNSName      string
			TailscaleIPs []string
		}
	}
	if json.Unmarshal(status, &state) != nil {
		return "", ""
	}
	dnsName = strings.TrimSuffix(strings.TrimSpace(state.Self.DNSName), ".")
	if dnsName == "" || strings.ContainsAny(dnsName, "/\\:@?# \t\r\n") {
		return "", ""
	}
	for _, value := range state.Self.TailscaleIPs {
		ip, err := netip.ParseAddr(value)
		if err == nil && isTailnetAddress(ip) {
			return ip.String(), dnsName
		}
	}
	return "", ""
}

func isTailnetAddress(ip netip.Addr) bool {
	return netip.MustParsePrefix("100.64.0.0/10").Contains(ip) || netip.MustParsePrefix("fd7a:115c:a1e0::/48").Contains(ip)
}
