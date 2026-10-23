"use client";
import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useApp } from "@/lib/store";
import { btnPrimary, Card, Notice } from "./ui";
import { fmtWhen } from "./Shell";

const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);

export function ImportCard() {
  const { server, refresh, settings, update, isSample } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<{ sent: number; total: number } | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const busy = upload !== null || phase !== null;
  const li = server.lastImport;

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  // Resume the progress display if an import is already running (e.g. the page was reloaded).
  useEffect(() => {
    fetch("/api/import", { cache: "no-store" }).then((r) => r.json()).then((s) => { if (s.running) { setPhase(s.phase || "Working"); poll(); } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function poll() {
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(async () => {
      try {
        const s = await (await fetch("/api/import", { cache: "no-store" })).json();
        if (s.running) setPhase(s.phase || "Working");
        else { clearInterval(timer.current!); timer.current = null; setPhase(null); setFile(null); await refresh(); }
      } catch { /* server busy; try again on the next tick */ }
    }, 1500);
  }

  function start() {
    if (!file) return;
    setError(null); setUpload({ sent: 0, total: file.size });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/import");
    xhr.setRequestHeader("x-fitdash", "1");
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUpload({ sent: e.loaded, total: e.total }); };
    xhr.onerror = () => { setUpload(null); setError("The upload failed. Is the FitDash server still running?"); };
    xhr.onload = () => {
      setUpload(null);
      let body: { error?: string } = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 202) { setPhase("Starting"); poll(); }
      else setError(body.error ?? `The server refused the file (${xhr.status}).`);
    };
    xhr.send(file);
  }

  const s = li?.summary;
  return (
    <div id="import" className="scroll-mt-20 lg:col-span-2">
      <Card title="Import from Apple Health" info="Apple does not let websites read the Health app, so FitDash reads the export file the Health app can create. Importing again later is safe: the same days and workouts are updated, never duplicated.">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-mute">
              <li>On your iPhone open <b className="text-ink">Health</b>, tap your <b className="text-ink">profile picture</b> (top right), then <b className="text-ink">Export All Health Data</b>. It can take a few minutes.</li>
              <li>Send the <b className="text-ink">export.zip</b> to your Mac (AirDrop works well).</li>
              <li>Choose it below. Large files (several hundred MB) can take a few minutes to read.</li>
            </ol>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <input type="file" accept=".zip,.xml,application/zip,text/xml" disabled={busy} aria-label="Apple Health export file"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
                className="max-w-full text-sm file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-surface2" />
              <button type="button" className={btnPrimary} disabled={!file || busy} onClick={start}><Upload size={14} aria-hidden /> Import</button>
            </div>
            {file && !busy && <p className="mt-2 text-xs text-mute">{file.name} · {mb(file.size)}</p>}
            {upload && <div className="mt-3" role="status"><p className="text-xs text-mute">Uploading to your own computer… {Math.round((upload.sent / upload.total) * 100)}% ({mb(upload.sent)} of {mb(upload.total)})</p>
              <progress className="mt-1 h-1.5 w-full" max={upload.total} value={upload.sent} /></div>}
            {phase && <p role="status" className="mt-3 text-sm">⏳ {phase}…<span className="block text-xs text-mute">You can leave this page open; nothing is lost if you reload.</span></p>}
            {error && <div className="mt-3"><Notice tone="bad" title="Import did not start">{error}</Notice></div>}
            <p className="mt-4 text-xs text-mute">For very large exports you can skip the upload and run <code className="rounded bg-surface2 px-1">npm run import -- ~/Downloads/export.zip</code> in the project folder.</p>
          </div>

          <div className="text-sm">
            {!li ? <Notice title="Nothing imported yet">Until you import, the dashboard shows clearly labelled sample data.</Notice>
              : li.status === "error" ? <Notice tone="bad" title={`Last import failed (${fmtWhen(li.finishedAt)})`}>{li.error}<br />Your previous data is unchanged.</Notice>
              : li.status === "running" ? <Notice title="An import is running">It started {fmtWhen(li.finishedAt)}.</Notice>
              : s && (
                <div>
                  <p className="font-medium">Last import: {fmtWhen(li.finishedAt)} <span className="font-normal text-mute">· {li.fileName}</span></p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <dt className="text-mute">Health data covers</dt><dd className="tnum">{s.firstDay ?? "—"} → {s.lastDay ?? "—"}</dd>
                    <dt className="text-mute">Days with data</dt><dd className="tnum">{s.days}</dd>
                    <dt className="text-mute">Runs</dt><dd className="tnum">{s.runs} ({s.runsWithRoute} with splits)</dd>
                    <dt className="text-mute">Strength sessions</dt><dd className="tnum">{s.strength}</dd>
                    <dt className="text-mute">Duplicate workouts removed</dt><dd className="tnum">{s.duplicateWorkoutsDropped}</dd>
                    <dt className="text-mute">Health records read</dt><dd className="tnum">{s.recordsSeen.toLocaleString()}</dd>
                  </dl>
                  {li.warnings.length > 0 && (
                    <div className="mt-3"><Notice tone="warn" title="Things to know"><ul className="list-disc space-y-1 pl-4 text-xs">{li.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Notice></div>
                  )}
                </div>
              )}
            {server.hasData && (
              <label className="mt-4 flex items-start gap-2 text-xs">
                <input type="checkbox" className="mt-0.5" checked={!!settings.previewSample} onChange={(e) => update({ previewSample: e.target.checked })} />
                <span><b className="font-medium">Preview with sample data instead</b><span className="block text-mute">Handy for exploring the layout. Your imported data is not touched. {isSample ? "Sample data is showing now." : ""}</span></span>
              </label>
            )}
          </div>
        </div>
        <p className="mt-4 border-t border-line pt-3 text-xs text-mute">
          <b>What comes in:</b> runs (with GPS splits and heart rate), strength workouts, calories and macros that MyFitnessPal wrote to Apple Health, steps, active and resting energy, resting heart rate, HRV, VO₂ max, respiratory rate and sleep.
          <b> What does not:</b> weight (you enter it by hand), Strava, other workout types, and food logged before MyFitnessPal&apos;s Apple Health sync was switched on.
        </p>
      </Card>
    </div>
  );
}
