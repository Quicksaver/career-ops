package main

import (
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func pdfServerFixture(t *testing.T) (*pdfLinkServer, string) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	s, err := servePDFLinks(listener, "127.0.0.1", dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.close)
	file := filepath.Join(dir, "11729-example CV-é.pdf")
	if err := os.WriteFile(file, []byte("%PDF-1.4\nfixture"), 0600); err != nil {
		t.Fatal(err)
	}
	return s, file
}

func TestPDFBrowserLinkServesInlinePDFAndRangesWithoutRedirect(t *testing.T) {
	s, file := pdfServerFixture(t)
	link := s.link(file)
	if link == "" || s.link(file) != link {
		t.Fatal("expected stable registered PDF link")
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	for _, c := range []struct {
		method, suffix, byteRange string
		status                    int
		body                      string
	}{
		{"GET", "", "", 200, "%PDF-1.4\nfixture"}, {"HEAD", "", "", 200, ""},
		{"GET", "", "bytes=0-3", 206, "%PDF"},
		{"POST", "", "", 405, ""}, {"GET", "?file=attacker", "", 404, ""},
		{"GET", "/unknown", "", 404, ""},
	} {
		req, _ := http.NewRequest(c.method, link+c.suffix, nil)
		// Browsers share cookies across ports on the same Tailnet hostname.
		req.Header.Set("Cookie", "other-app-session="+strings.Repeat("x", 16*1024))
		if c.byteRange != "" {
			req.Header.Set("Range", c.byteRange)
		}
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != c.status {
			t.Fatalf("%s %s: %d", c.method, c.suffix, res.StatusCode)
		}
		if res.Header.Get("Location") != "" {
			t.Fatal("PDF link redirects to another application")
		}
		if c.status == 200 || c.status == 206 {
			if string(body) != c.body || res.Header.Get("Content-Type") != "application/pdf" || !strings.HasPrefix(res.Header.Get("Content-Disposition"), "inline;") {
				t.Fatalf("incorrect browser PDF response: %q %v", body, res.Header)
			}
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
		if server, err := startPDFLinkServer(host, "workstation.example.ts.net", t.TempDir()); err == nil {
			server.close()
			t.Fatalf("accepted non-Tailnet bind %q", host)
		}
	}
}

func TestPDFLinksRejectOutsideFilesAndOtherTypes(t *testing.T) {
	s, _ := pdfServerFixture(t)
	outside := filepath.Join(t.TempDir(), "private.pdf")
	if err := os.WriteFile(outside, []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	other := filepath.Join(s.outputDir, "secret.txt")
	if err := os.WriteFile(other, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{outside, other, "relative.pdf", "vscode://vscode-remote/ssh-remote+host/output/cv.pdf:1", filepath.Join(s.outputDir, "missing.pdf")} {
		if s.link(target) != "" {
			t.Fatalf("accepted %q", target)
		}
	}
}

func TestPDFLinkCannotEscapeViaSymlinkAfterRegistration(t *testing.T) {
	s, file := pdfServerFixture(t)
	link := s.link(file)
	outside := filepath.Join(t.TempDir(), "private.pdf")
	if err := os.WriteFile(outside, []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	probe := filepath.Join(s.outputDir, "symlink.pdf")
	if err := os.Symlink(outside, probe); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if s.link(probe) != "" {
		t.Fatal("registered an escaping symlink")
	}
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, file); err != nil {
		t.Fatal(err)
	}
	res, err := http.Get(link)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != 404 || strings.Contains(string(body), "private") {
		t.Fatal("served a replaced file outside the output root")
	}
}
