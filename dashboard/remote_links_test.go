package main

import "testing"

func TestViewerRemoteAddressBindsOnlyToOwnTailnetIP(t *testing.T) {
	status := []byte(`{"Self":{"DNSName":"workstation.example.ts.net.","TailscaleIPs":["192.168.1.5","100.70.80.90"]},"Peer":{"other":{"DNSName":"peer.example.ts.net.","TailscaleIPs":["100.80.90.100"]}}}`)
	ip, dns := viewerRemoteAddress(status)
	if ip != "100.70.80.90" || dns != "workstation.example.ts.net" {
		t.Fatalf("unexpected self address: %q %q", ip, dns)
	}
	for _, status := range []string{"invalid",
		`{"Self":{"DNSName":"workstation.example.ts.net.","TailscaleIPs":["0.0.0.0","127.0.0.1"]}}`,
		`{"Self":{"DNSName":"bad/path","TailscaleIPs":["100.70.80.90"]}}`,
	} {
		ip, _ := viewerRemoteAddress([]byte(status))
		if ip != "" {
			t.Fatalf("accepted unsafe/missing address: %s", status)
		}
	}
}
