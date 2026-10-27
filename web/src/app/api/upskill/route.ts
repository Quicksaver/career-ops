import { execFile } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript, careerOpsCoreEnv } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The weighted skill-gap map from the core's upskill.mjs: which skills keep
// costing you roles, weighted so a 2.1/5 report counts for more than a 4.5/5 one.
//
// Request machine output explicitly; the fork defaults to human output.
// Never writes. upskill.mjs's own header is explicit that it never adds a claim
// to cv.md, and this route only reads its verdict.
export async function GET() {
  const script = rootScript("upskill");
  if (!fs.existsSync(script)) return Response.json({ available: false, reason: "no-script", data: null });

  const stdout = await new Promise<string>((resolve) => {
    // process.execPath + windowsHide: see api/doctor/route.ts — a stale inherited
    // console kills every child with 0xC0000142 on Windows; never inherit one.
    execFile(process.execPath, [script, "--json"], { cwd: careerOpsRoot(), env: careerOpsCoreEnv(), timeout: 30_000, maxBuffer: 8 << 20, windowsHide: true }, (_err, out) =>
      resolve(out || ""),
    );
  });

  try {
    const start = stdout.indexOf("{");
    if (start < 0) throw new Error("no JSON");
    return Response.json({ available: true, reason: null, data: JSON.parse(stdout.slice(start)) });
  } catch {
    return Response.json({ available: false, reason: "unparseable", data: null });
  }
}
