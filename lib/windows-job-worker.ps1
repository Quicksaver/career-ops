param([Parameter(Mandatory=$true)][string]$PayloadFile, [Parameter(Mandatory=$true)][string]$ResultFile)
$ErrorActionPreference = 'Stop'

# Keep launch JSON outside argv without consuming the worker's inherited stdin.
try {
  $launch = [IO.File]::ReadAllText($PayloadFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
} finally {
  if ([IO.File]::Exists($PayloadFile)) { [IO.File]::Delete($PayloadFile) }
}

# Assign the job at process creation, before any worker code can run. Closing
# this helper's last handle also stops descendants if the supervisor is killed.
# https://learn.microsoft.com/windows/win32/procthread/job-objects
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class CareerOpsOwnedJob {
  [StructLayout(LayoutKind.Sequential)] struct Limits {
    public long ProcessTime, JobTime; public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveLimit;
    public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public Limits Basic; public IoCounters Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
    public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public uint Size; public string Reserved, Desktop, Title;
    public uint X, Y, Width, Height, CharsX, CharsY, Fill, Flags;
    public ushort Show, ReservedSize; public IntPtr ReservedBytes, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Basic; public IntPtr Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting info, uint size, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr kind, IntPtr value, IntPtr size, IntPtr oldValue, IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupEx startup, out ProcessInfo info);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static string Quote(string value) {
    var text = new StringBuilder("\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      text.Append('\\', c == '"' ? slashes * 2 + 1 : slashes).Append(c); slashes = 0;
    }
    return text.Append('\\', slashes * 2).Append('"').ToString();
  }
  public static int Run(string app, string[] args, bool verbatim, int ownerPid) {
    IntPtr job = IntPtr.Zero, list = IntPtr.Zero, value = IntPtr.Zero;
    ProcessInfo child = new ProcessInfo(); bool initialized = false;
    using (var owner = Process.GetProcessById(ownerPid)) {
      // Keep the native handle, so PID reuse cannot substitute another owner.
      var ownerHandle = owner.Handle;
      try {
        if (owner.HasExited) throw new Exception("Worker supervisor exited before launch");
        job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
        var limits = new ExtendedLimits(); limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE
        Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)));
        IntPtr size = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
        list = Marshal.AllocHGlobal(size); Check(InitializeProcThreadAttributeList(list, 1, 0, ref size)); initialized = true;
        value = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(value, job);
        Check(UpdateProcThreadAttribute(list, 0, new IntPtr(0x2000D), value, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero)); // JOB_LIST
        var startup = new StartupEx(); startup.Basic.Size = (uint)Marshal.SizeOf(startup); startup.Attributes = list;
        startup.Basic.Flags = 0x100; // USESTDHANDLES
        startup.Basic.Input = GetStdHandle(-10); startup.Basic.Output = GetStdHandle(-11); startup.Basic.Error = GetStdHandle(-12);
        var command = new StringBuilder(Quote(app));
        foreach (string arg in args) command.Append(' ').Append(verbatim ? arg : Quote(arg));
        Check(CreateProcess(app, command, IntPtr.Zero, IntPtr.Zero, true, 0x80000 | 0x08000000 | 4, IntPtr.Zero, null, ref startup, out child));
        if (owner.HasExited) throw new Exception("Worker supervisor exited before dispatch");
        Check(ResumeThread(child.Thread) != 0xFFFFFFFF);
        uint wait;
        while ((wait = WaitForSingleObject(child.Process, 100)) == 0x102) {
          if (owner.HasExited) throw new Exception("Worker supervisor exited during dispatch");
        }
        Check(wait == 0);
        uint code; Check(GetExitCodeProcess(child.Process, out code));
        Check(TerminateJobObject(job, 125));
        var deadline = Stopwatch.StartNew();
        while (true) {
          Accounting active; Check(QueryInformationJobObject(job, 1, out active, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
          if (active.ActiveProcesses == 0) break;
          if (deadline.ElapsedMilliseconds > 5000) throw new Exception("Worker job cleanup did not drain");
          Thread.Sleep(10);
        }
        return unchecked((int)code);
      } finally {
        if (job != IntPtr.Zero) CloseHandle(job);
        if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
        if (child.Process != IntPtr.Zero) CloseHandle(child.Process);
        if (initialized) DeleteProcThreadAttributeList(list);
        if (list != IntPtr.Zero) Marshal.FreeHGlobal(list);
        if (value != IntPtr.Zero) Marshal.FreeHGlobal(value);
      }
    }
  }
}
'@

try {
  $workerExit = [CareerOpsOwnedJob]::Run([string]$launch.command, [string[]]$launch.args, [bool]$launch.verbatim, [int]$launch.ownerPid)
  [IO.File]::WriteAllText($ResultFile, ('{"drained":true,"exit_code":' + $workerExit + '}'))
  exit $workerExit
} catch {
  [Console]::Error.WriteLine('CAREER_OPS_JOB_CLEANUP_FAILED: ' + $_.Exception.Message)
  exit 125
}
