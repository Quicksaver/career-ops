package main

import (
	"crypto/rand"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"
)

// PDF links need a browser handoff: terminal clients may interpret vscode://
// as a host path, and Microsoft's redirect adds query data to the PDF URI.
// This listener binds only to this machine's Tailnet address. It serves no
// files, directory listings, or caller-supplied redirect destinations.
type pdfLinkServer struct {
	server  *http.Server
	baseURL string
	mu      sync.Mutex
	targets map[string]string
	links   map[string]string
}

func startPDFLinkServer(bindIP, dnsName string) (*pdfLinkServer, error) {
	ip, err := netip.ParseAddr(bindIP)
	if err != nil || !isTailnetAddress(ip) {
		return nil, errors.New("PDF link listener requires a Tailnet IP")
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(bindIP, "0"))
	if err != nil {
		return nil, err
	}
	return servePDFLinks(listener, dnsName), nil
}

func servePDFLinks(listener net.Listener, dnsName string) *pdfLinkServer {
	_, port, _ := net.SplitHostPort(listener.Addr().String())
	s := &pdfLinkServer{
		baseURL: "http://" + net.JoinHostPort(dnsName, port),
		targets: make(map[string]string),
		links:   make(map[string]string),
	}
	s.server = &http.Server{
		Handler:           http.HandlerFunc(s.serveHTTP),
		ReadHeaderTimeout: 3 * time.Second,
		WriteTimeout:      3 * time.Second,
		IdleTimeout:       10 * time.Second,
		MaxHeaderBytes:    8192,
	}
	go func() { _ = s.server.Serve(listener) }()
	return s
}

func (s *pdfLinkServer) close() { _ = s.server.Close() }

func (s *pdfLinkServer) link(target string) string {
	u, err := url.Parse(target)
	if err != nil || u.Scheme != "vscode" || u.Host != "vscode-remote" ||
		u.RawQuery != "" || u.Fragment != "" || !strings.HasPrefix(u.Path, "/ssh-remote+") ||
		!strings.HasSuffix(strings.ToLower(u.Path), ".pdf:1") || strings.ContainsAny(target, "\r\n\x00") {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if link := s.links[target]; link != "" {
		return link
	}
	token := rand.Text()
	s.targets["/"+token] = target
	link := s.baseURL + "/" + token
	s.links[target] = link
	return link
}

func (s *pdfLinkServer) serveHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'")
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	s.mu.Lock()
	target := s.targets[r.URL.Path]
	s.mu.Unlock()
	if target == "" || r.URL.RawQuery != "" {
		http.NotFound(w, r)
		return
	}
	// Do not copy request parameters into the destination. VS Code preserves
	// them on the remote resource, breaking PDF.js's authorized resource URL.
	w.Header().Set("Location", target)
	w.WriteHeader(http.StatusFound)
}
