package main

import (
	"io"
	"net"
	"net/http"
	"net/url"
	"testing"
)

func TestPDFBrowserHandoffPreservesCleanFileURI(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := servePDFLinks(listener, "127.0.0.1")
	t.Cleanup(s.close)
	target := "vscode://vscode-remote/ssh-remote+operator@workstation.example.ts.net/E:/Career%20Ops/output/11729-CV-%C3%A9.pdf:1"
	link := s.link(target)
	if link == "" || s.link(target) != link {
		t.Fatal("expected stable registered PDF link")
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	for _, c := range []struct {
		method, suffix string
		status         int
	}{
		{"GET", "", http.StatusFound}, {"HEAD", "", http.StatusFound},
		{"POST", "", http.StatusMethodNotAllowed},
		{"GET", "?url=attacker", http.StatusNotFound}, {"GET", "/unknown", http.StatusNotFound},
	} {
		req, _ := http.NewRequest(c.method, link+c.suffix, nil)
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, res.Body)
		res.Body.Close()
		if res.StatusCode != c.status {
			t.Fatalf("%s %s: %d", c.method, c.suffix, res.StatusCode)
		}
		if c.status == http.StatusFound {
			if res.Header.Get("Location") != target {
				t.Fatalf("redirect polluted PDF URI: %q", res.Header.Get("Location"))
			}
			uri, _ := url.Parse(res.Header.Get("Location"))
			if uri.RawQuery != "" || uri.Fragment != "" {
				t.Fatal("PDF URI includes browser handoff parameters")
			}
		} else if res.Header.Get("Location") != "" {
			t.Fatal("unregistered request redirected")
		}
	}
	s.close()
	if res, err := client.Get(link); err == nil {
		res.Body.Close()
		t.Fatal("listener survived dashboard shutdown")
	}
}

func TestPDFLinkListenerCannotBindOutsideTailnet(t *testing.T) {
	for _, host := range []string{"0.0.0.0", "::", "127.0.0.1", "192.168.1.5", "example.com"} {
		if server, err := startPDFLinkServer(host, "workstation.example.ts.net"); err == nil {
			server.close()
			t.Fatalf("accepted non-Tailnet bind %q", host)
		}
	}
}

func TestPDFLinkHandoffRejectsOtherDestinations(t *testing.T) {
	s := &pdfLinkServer{}
	for _, target := range []string{
		"https://attacker.invalid/", "vscode://settings/anything.pdf:1",
		"vscode://vscode-remote/ssh-remote+host/etc/private.txt:1",
		"vscode://vscode-remote/ssh-remote+host/output/cv.pdf:1?url=other",
		"vscode://vscode-remote/ssh-remote+host/output/cv.pdf:1#fragment",
	} {
		if s.link(target) != "" {
			t.Fatalf("accepted %q", target)
		}
	}
}
