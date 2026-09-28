import { useState } from "react";
import { CRON_JOBS, type CronJob } from "../data";
import type { ExecResult, HermesApi, LiveJob } from "../api";
import { useLive, usePersisted } from "../hooks";
import { Badge, Led, Panel, Toggle } from "../components/ui";
import { cn } from "../utils/cn";

function fmtWhen(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function Automations({ api, online }: { api: HermesApi; online: boolean }) {
  const cron = useLive(online, () => api.cron(), 15000);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ExecResult | null>(null);
  const [form, setForm] = useState({ schedule: "", prompt: "", name: "" });

  // demo state
  const [enabled, setEnabled] = usePersisted<Record<string, boolean>>(
    "hermes.mc.cron",
    Object.fromEntries(CRON_JOBS.map((j) => [j.id, j.enabled])),
  );

  const act = async (action: string, id: string) => {
    setBusy(id + action);
    try {
      const r = await api.cronAction(action, id);
      setResult(r);
      cron.refresh();
    } catch (e) {
      setResult({ ok: false, code: 1, stdout: "", stderr: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!form.schedule.trim() || !form.prompt.trim()) return;
    setBusy("create");
    try {
      const r = await api.cronCreate(form.schedule.trim(), form.prompt.trim(), form.name.trim() || undefined);
      setResult(r);
      if (r.ok) setForm({ schedule: "", prompt: "", name: "" });
      cron.refresh();
    } catch (e) {
      setResult({ ok: false, code: 1, stdout: "", stderr: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const jobs = cron.data?.jobs;
  const armed = jobs ? jobs.filter((j) => j.enabled).length : CRON_JOBS.filter((j) => enabled[j.id]).length;
  const total = jobs ? jobs.length : CRON_JOBS.length;

  return (
    <div className="space-y-3">
      <Panel
        title="Scheduled Automations"
        right={
          <div className="flex items-center gap-2">
            {jobs && (
              <button onClick={cron.refresh} className="text-[9px] uppercase tracking-widest text-mute hover:text-ink">
                ↻ refresh
              </button>
            )}
            <Badge tone="gold">{armed}/{total} armed</Badge>
          </div>
        }
      >
        {jobs ? (
          jobs.length ? (
            <ul className="space-y-2">
              {jobs.map((j) => (
                <LiveJobRow key={j.id} job={j} busy={busy} onAct={act} />
              ))}
            </ul>
          ) : (
            <div className="py-6 text-center text-[11px] text-mute">
              no jobs in <span className="text-gold">~/.hermes/cron/jobs.json</span> — create one below
            </div>
          )
        ) : (
          <ul className="space-y-2">
            {CRON_JOBS.map((j) => (
              <DemoJobRow key={j.id} job={j} on={!!enabled[j.id]} onToggle={(v) => setEnabled((p) => ({ ...p, [j.id]: v }))} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={online ? "Create job · hermes cron create" : "Compose in natural language"}>
        <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <input
            value={form.schedule}
            onChange={(e) => setForm({ ...form, schedule: e.target.value })}
            placeholder='schedule — "every 2h", "0 7 * * *", "weekdays at 9am"'
            className="rounded-md border border-edge bg-void/60 px-2.5 py-2 text-xs text-ink placeholder-mute/60 outline-none focus:border-gold/40"
          />
          <input
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            placeholder="prompt — self-contained task for a fresh agent session"
            className="rounded-md border border-edge bg-void/60 px-2.5 py-2 text-xs text-ink placeholder-mute/60 outline-none focus:border-gold/40"
          />
          <button
            disabled={!online || busy === "create" || !form.schedule || !form.prompt}
            onClick={create}
            className="rounded-md border border-gold/50 bg-gold/15 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold/25 disabled:opacity-40"
          >
            {busy === "create" ? "…" : "Create"}
          </button>
        </div>
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="name (optional)"
          className="mt-2 w-full rounded-md border border-edge bg-void/60 px-2.5 py-1.5 text-xs text-ink placeholder-mute/60 outline-none focus:border-gold/40 sm:w-1/3"
        />
        <p className="mt-2 text-[10px] text-mute">
          {online
            ? "Runs `hermes cron create <schedule> <prompt>` through the bridge. Jobs fire from the gateway daemon (hermes gateway)."
            : "Connect the Python bridge to create real jobs — currently in demo mode."}
        </p>
      </Panel>

      {result && (
        <Panel title="Last command output" right={<Badge tone={result.ok ? "mint" : "alert"}>exit {result.code}</Badge>}>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed text-ink/85">
            {result.stdout || result.stderr || "(no output)"}
          </pre>
        </Panel>
      )}
    </div>
  );
}

function LiveJobRow({ job, busy, onAct }: { job: LiveJob; busy: string | null; onAct: (a: string, id: string) => void }) {
  const on = job.enabled;
  const statusTone = job.last_status === "success" || job.last_status === "ok" ? "mint" : job.last_status ? (job.last_status.includes("fail") || job.last_status.includes("error") || job.last_status.includes("blocked") ? "alert" : "warn") : "mute";
  const overdue = on && job.next_run_at && new Date(job.next_run_at).getTime() < Date.now() - 15 * 60e3;
  return (
    <li className={cn("rounded-md border p-2.5 transition-all", on ? "border-edge/80 bg-panel2/70" : "border-edge/40 bg-panel2/30 opacity-70")}>
      <div className="flex items-center gap-2.5">
        <Led color={on ? (statusTone === "alert" ? "alert" : "mint") : "mute"} pulse={on} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-xs font-bold text-ink">{job.name}</span>
            {job.last_status && <Badge tone={statusTone}>{job.last_status}</Badge>}
            {overdue && <Badge tone="alert">overdue</Badge>}
            {job.no_agent && <Badge tone="teal">no-agent</Badge>}
            {job.skills?.length > 0 && <Badge tone="mute">⑂ {job.skills.join(", ")}</Badge>}
          </div>
          <div className="mt-0.5 text-[10px] text-mute">
            <span className="text-gold">{job.schedule || "—"}</span> · → {job.deliver} · <span className="text-mute/70">{job.id}</span>
          </div>
        </div>
        <Toggle on={on} onChange={(v) => onAct(v ? "resume" : "pause", job.id)} />
      </div>
      {job.prompt && <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-ink/70">{job.prompt}</p>}
      {job.last_error && <p className="mt-1 text-[10px] text-alert">✗ {job.last_error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-edge/60 pt-1.5 text-[10px] tabular-nums text-mute">
        <span>last <span className="text-ink/80">{fmtWhen(job.last_run_at)}</span></span>
        <span>next <span className={overdue ? "text-alert" : "text-teal"}>{on ? fmtWhen(job.next_run_at) : "—"}</span></span>
        {job.runs != null && <span>{job.runs} runs</span>}
        <span className="ml-auto flex gap-1">
          <button disabled={!!busy} onClick={() => onAct("run", job.id)} className="rounded border border-teal/40 px-2 py-0.5 text-[9px] font-bold uppercase text-teal hover:bg-teal/10 disabled:opacity-40">
            {busy === job.id + "run" ? "…" : "▶ run"}
          </button>
          <button
            disabled={!!busy}
            onClick={() => confirm(`Remove job "${job.name}"?`) && onAct("remove", job.id)}
            className="rounded border border-alert/40 px-2 py-0.5 text-[9px] font-bold uppercase text-alert hover:bg-alert/10 disabled:opacity-40"
          >
            ✕
          </button>
        </span>
      </div>
    </li>
  );
}

function DemoJobRow({ job, on, onToggle }: { job: CronJob; on: boolean; onToggle: (v: boolean) => void }) {
  return (
    <li className={cn("rounded-md border p-2.5 transition-all", on ? "border-edge/80 bg-panel2/70" : "border-edge/40 bg-panel2/30 opacity-60")}>
      <div className="flex items-center gap-2.5">
        <Led color={on ? (job.lastStatus === "fail" ? "alert" : "mint") : "mute"} pulse={on} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-bold text-ink">{job.name}</span>
            <Badge tone={job.lastStatus === "ok" ? "mint" : job.lastStatus === "fail" ? "alert" : "mute"}>{job.lastStatus}</Badge>
          </div>
          <div className="mt-0.5 text-[10px] text-mute">
            <span className="text-gold">{job.expr}</span> · {job.human} · → {job.delivery}
          </div>
        </div>
        <Toggle on={on} onChange={onToggle} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 border-t border-edge/60 pt-1.5 text-[10px] tabular-nums text-mute">
        <span>last <span className="text-ink/80">{job.lastRun}</span></span>
        <span>next <span className="text-teal">{on ? job.nextRun : "—"}</span></span>
        <span className="ml-auto">{job.runs} runs</span>
      </div>
    </li>
  );
}
