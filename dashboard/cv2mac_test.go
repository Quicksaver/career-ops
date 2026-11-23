package main

import (
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/ui/screens"
)

func fakeLookPath(found map[string]string) func(string) (string, error) {
	return func(name string) (string, error) {
		if path, ok := found[name]; ok {
			return path, nil
		}
		return "", errors.New("not found")
	}
}

func TestFindCV2MacPrefersAnExecutableThenTheWindowsScript(t *testing.T) {
	cases := []struct {
		name  string
		found map[string]string
		goos  string
		want  []string
	}{
		{"executable", map[string]string{"cv2mac": "/bin/cv2mac", "cv2mac.ps1": "x", "pwsh": "p"}, "windows", []string{"/bin/cv2mac"}},
		{"script via pwsh", map[string]string{"cv2mac.ps1": `C:\bin\cv2mac.ps1`, "pwsh": "pwsh.exe", "powershell": "powershell.exe"}, "windows",
			[]string{"pwsh.exe", "-NoProfile", "-NonInteractive", "-File", `C:\bin\cv2mac.ps1`}},
		{"script via Windows PowerShell", map[string]string{"cv2mac.ps1": `C:\bin\cv2mac.ps1`, "powershell": "powershell.exe"}, "windows",
			[]string{"powershell.exe", "-NoProfile", "-NonInteractive", "-File", `C:\bin\cv2mac.ps1`}},
		{"script without a shell", map[string]string{"cv2mac.ps1": `C:\bin\cv2mac.ps1`}, "windows", nil},
		{"script off Windows", map[string]string{"cv2mac.ps1": "/bin/cv2mac.ps1", "pwsh": "/bin/pwsh"}, "linux", nil},
		{"nothing", nil, "windows", nil},
	}
	for _, tc := range cases {
		got := findCV2MacWith(fakeLookPath(tc.found), tc.goos)
		if fmt.Sprint(got) != fmt.Sprint(tc.want) {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}

// TestCV2MacHelperProcess stands in for cv2mac when runCV2Mac runs the test
// binary itself.
func TestCV2MacHelperProcess(t *testing.T) {
	mode := os.Getenv("CV2MAC_HELPER")
	if mode == "" {
		return
	}
	pdf := os.Args[len(os.Args)-1]
	switch mode {
	case "ok":
		fmt.Printf("Copied %s to macbook-pro:~/Downloads\r\n", pdf)
		os.Exit(0)
	case "fail":
		fmt.Fprint(os.Stderr, "\x1b[31;1mLine |\r\n  44 |  throw\r\n\x1b[36;1m     | \x1b[31;1mscp failed with exit code 255\x1b[0m\r\n\x1b[36;1m\x1b[0m\r\n")
		os.Exit(1)
	}
}

func TestRunCV2MacReportsTheToolsLastLine(t *testing.T) {
	argv := []string{os.Args[0], "-test.run=^TestCV2MacHelperProcess$", "--"}
	t.Setenv("CV2MAC_HELPER", "ok")
	got := runCV2Mac(argv, `E:\out\cv.pdf`)().(screens.ViewerCV2MacDoneMsg)
	if got.Err != "" || got.Output != `Copied E:\out\cv.pdf to macbook-pro:~/Downloads` {
		t.Fatalf("success = %#v", got)
	}
	t.Setenv("CV2MAC_HELPER", "fail")
	got = runCV2Mac(argv, `E:\out\cv.pdf`)().(screens.ViewerCV2MacDoneMsg)
	if got.Err != "scp failed with exit code 255" {
		t.Fatalf("failure = %#v", got)
	}
	if got := runCV2Mac(nil, "x.pdf")().(screens.ViewerCV2MacDoneMsg); got.Err == "" {
		t.Fatal("missing tool reported success")
	}
}
