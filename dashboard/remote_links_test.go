package main

import "testing"

func TestViewerSSHHostUsesTailnetDNSAndOSAccount(t *testing.T) {
	status := []byte(`{"Self":{"DNSName":"workstation.example.ts.net.","HostName":"WORKSTATION"},"Peer":{"other":{"DNSName":"other.example.ts.net."}}}`)
	for _, account := range []string{`WORKSTATION\operator`, "operator"} {
		if got := viewerSSHHost("", account, status); got != "operator@workstation.example.ts.net" {
			t.Errorf("account %q: SSH host = %q", account, got)
		}
	}
}

func TestViewerSSHHostOverrideAndLocalFallback(t *testing.T) {
	for _, c := range []struct{ override, account, json, want string }{
		{"custom@server.example.ts.net:2222", "", "invalid", "custom@server.example.ts.net:2222"},
		{"local", "operator", `{"Self":{"DNSName":"workstation.example.ts.net."}}`, ""},
		{"", "operator", "invalid", ""},
		{"", "operator", `{"Self":{}}`, ""},
		{"", "", `{"Self":{"DNSName":"workstation.example.ts.net."}}`, ""},
	} {
		if got := viewerSSHHost(c.override, c.account, []byte(c.json)); got != c.want {
			t.Errorf("override %q account %q: got %q, want %q", c.override, c.account, got, c.want)
		}
	}
}
