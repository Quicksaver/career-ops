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

func TestViewerRemoteAddressBindsOnlyToOwnTailnetIP(t *testing.T) {
	status := []byte(`{"Self":{"DNSName":"workstation.example.ts.net.","TailscaleIPs":["192.168.1.5","100.70.80.90"]},"Peer":{"other":{"DNSName":"peer.example.ts.net.","TailscaleIPs":["100.80.90.100"]}}}`)
	host, ip, dns := viewerRemoteAddress("", `WORKSTATION\operator`, status)
	if host != "operator@workstation.example.ts.net" || ip != "100.70.80.90" || dns != "workstation.example.ts.net" {
		t.Fatalf("unexpected self address: %q %q %q", host, ip, dns)
	}
	for _, c := range []struct{ override, status string }{
		{"local", string(status)}, {"", "invalid"},
		{"", `{"Self":{"DNSName":"workstation.example.ts.net.","TailscaleIPs":["0.0.0.0","127.0.0.1"]}}`},
		{"", `{"Self":{"DNSName":"bad/path","TailscaleIPs":["100.70.80.90"]}}`},
	} {
		_, ip, _ := viewerRemoteAddress(c.override, "operator", []byte(c.status))
		if ip != "" {
			t.Fatalf("accepted unsafe/missing address: %s", c.status)
		}
	}
}
