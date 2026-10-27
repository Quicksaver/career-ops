import { execFile } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript, careerOpsCoreEnv } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lifetime pipeline stats, read from the core's own stats.mjs — the SAME
// calculator the CLI and the Go dashboard funnel agree on. We never recompute a
// rate here: computeFunnel()'s docstring in stats.mjs is the canonical funnel
// definition ("Hired counts into every stage through everOffer"), and a second
// implementation in TypeScript is how the web's numbers start disagreeing with
// the CLI's. Mirrors /api/followups and /api/doctor.
//
// Request machine output explicitly; the fork defaults to human output.
export async function GET() {
  const script = rootScript("stats");
  if (!fs.existsSync(script)) return Response.json({ available: false, stats: null });

  const stdout = await new Promise<string>((resolve) => {
    // process.execPath + windowsHide: see api/doctor/route.ts — a stale inherited
    // console kills every child with 0xC0000142 on Windows; never inherit one.
    execFile(process.execPath, [script, "--json"], { cwd: careerOpsRoot(), env: careerOpsCoreEnv(), timeout: 20_000, maxBuffer: 8 << 20, windowsHide: true }, (err, out) =>
      resolve(err ? "" : out || ""),
    );
  });

  try {
    // dotenv and friends can print a banner before the payload, so the JSON
    // starts at the first brace rather than at byte 0 (the same slice
    // /api/followups uses).
    const start = stdout.indexOf("{");
    if (start < 0) return Response.json({ available: false, stats: null });
    return Response.json({ available: true, stats: JSON.parse(stdout.slice(start)) });
  } catch {
    return Response.json({ available: false, stats: null });
  }
}
