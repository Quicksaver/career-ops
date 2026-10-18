package main

import (
	"crypto/rand"
	"errors"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Serve only registered PDFs from the active user's output directory, through
// opaque links on this machine's Tailnet address. The open root prevents a
// replaced file or symlink from escaping that directory after registration.
type pdfLinkServer struct {
	server    *http.Server
	baseURL   string
	mu        sync.Mutex
	targets   map[string]string
	links     map[string]string
	outputDir string
	root      *os.Root
}

func startPDFLinkServer(bindIP, dnsName, outputDir string) (*pdfLinkServer, error) {
	ip, err := netip.ParseAddr(bindIP)
	if err != nil || !isTailnetAddress(ip) {
		return nil, errors.New("PDF link listener requires a Tailnet IP")
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(bindIP, "0"))
	if err != nil {
		return nil, err
	}
	return servePDFLinks(listener, dnsName, outputDir)
}

func servePDFLinks(listener net.Listener, dnsName, outputDir string) (*pdfLinkServer, error) {
	outputDir, err := filepath.Abs(outputDir)
	if err != nil {
		listener.Close()
		return nil, err
	}
	root, err := os.OpenRoot(outputDir)
	if err != nil {
		listener.Close()
		return nil, err
	}
	_, port, _ := net.SplitHostPort(listener.Addr().String())
	s := &pdfLinkServer{
		baseURL:   "http://" + net.JoinHostPort(dnsName, port),
		targets:   make(map[string]string),
		links:     make(map[string]string),
		outputDir: outputDir,
		root:      root,
	}
	s.server = &http.Server{
		Handler:           http.HandlerFunc(s.serveHTTP),
		ReadHeaderTimeout: 3 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       10 * time.Second,
	}
	go func() { _ = s.server.Serve(listener) }()
	return s, nil
}

func (s *pdfLinkServer) close() { _ = s.server.Close(); _ = s.root.Close() }

func (s *pdfLinkServer) link(target string) string {
	if !filepath.IsAbs(target) || !strings.EqualFold(filepath.Ext(target), ".pdf") {
		return ""
	}
	rel, err := filepath.Rel(s.outputDir, target)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return ""
	}
	file, err := s.root.Open(rel)
	if err != nil {
		return ""
	}
	info, err := file.Stat()
	file.Close()
	if err != nil || !info.Mode().IsRegular() {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if link := s.links[rel]; link != "" {
		return link
	}
	token := rand.Text()
	s.targets["/"+token] = rel
	link := s.baseURL + "/" + token
	s.links[rel] = link
	return link
}

func (s *pdfLinkServer) serveHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
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
	file, err := s.root.Open(target)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": info.Name()}))
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}
