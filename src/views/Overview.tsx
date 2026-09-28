import { CRON_JOBS } from "../data";
import type { HermesApi, LiveJob, McpServer } from "../api";
import type { Telemetry } from "../hooks";
import { useLive } from "../hooks";
import { Badge, Led, Meter, Panel, Sparkline, Stat } from "../components/ui";
import { cn } from "../utils/cn";

const LEVEL_COLOR: Record<string, string> = {
  info: "text-mute",
  warn: "text-warn",
  error: "text-alert",
  tool: "text-teal",
  cron: "text-gold",
  agent: "text-ink/80",
  debug: "text-mute/60",
};

function relativeTime(value?: string | null) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const delta = date.getTime() - Date.now();
  const minutes = Math.round(Math.abs(delta) / 60000);
  const label = minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
  return delta > 0 ? `in ${label}` : `${label} ago`;
}

export default function Overview({
  api,
  online,
  t,
  logs,
  onOpenConsole,
}: {
  api: HermesApi;
  online: boolean;
  t: Telemetry;
  logs: Array<{ id: number; ts: string; level: string; source: string; msg: string }>;
  onOpenConsole: () => void;
}) {
  const cron = useLive(online, () => api.cron(), 20000);
  const mcp = useLive(online, () => api.mcp(), 20000);
  const sessions = useLive(online, () => api.sessions(), 30000);
  const h = t.status?.hermes;
  const jobs: LiveJob[] = cron.data?.jobs ?? [];
  const servers: McpServer[] = mcp.data?.servers ?? [];
  const upcoming = jobs.filter((j) => j.enabled).sort((a, b) => (a.next_run_at ?? "").localeCompare(b.next_run_at ?? "")).slice(0, 4);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.23em] text-gold/80">Operations</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            {online ? (h?.gateway_running ? "Hermes is running." : "Hermes is standing by.") : "Your agent, at a glance."}
          </h1>
          <p className="mt-1 text-xs text-mute">
            {online ? `${h?.provider ?? "Configured provider"} · ${h?.model ?? "default model"} · local Termux node` : "Connect the Python bridge for live device and agent data."}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-mute">
          <Led color={online ? (h?.gateway_running ? "mint" : "warn") : "gold"} pulse={online && !!h?.gateway_running} />
          {online ? (h?.gateway_running ? "Gateway active" : "Gateway not running") : "Preview data"}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-y-4 rounded-xl border border-white/[0.06] bg-panel/45 px-4 py-4 sm:grid-cols-4 sm:px-5">
        <Stat label="Sessions" value={online ? sessions.data?.total ?? "n/a" : "5"} sub={online ? "local history" : "preview"} accent="text-ink" />
        <Stat label="Routines" value={online ? `${h?.cron_enabled ?? 0}/${h?.cron_total ?? 0}` : "4/5"} sub="enabled" accent="text-gold" />
        <Stat label="MCP servers" value={online ? servers.length : "n/a"} sub={online ? "configured" : "connect bridge"} accent="text-teal" />
        <Stat label="Skills" value={online ? h?.skills_total ?? "n/a" : "n/a"} sub={online ? "installed" : "live on connect"} accent="text-ink" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
        <Panel title="Device condition" right={t.live ? <Badge tone="mint"><Led color="mint" pulse /> LIVE</Badge> : <Badge tone="mute">SIMULATED</Badge>}>
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_0.75fr]">
            <div className="space-y-4">
              <Meter label="Processor" value={t.cpu} />
              <Meter label="Memory" value={t.mem} />
              <Meter label={t.live ? "Storage" : "Context"} value={t.ctx} tone="gold" />
              <div className="grid grid-cols-3 gap-3 border-t border-edge pt-3">
                <div><div className="text-[9px] uppercase tracking-[0.12em] text-mute">Battery</div><div className="mt-1 text-sm font-medium tabular-nums text-ink">{t.battery.toFixed(0)}%</div></div>
                <div><div className="text-[9px] uppercase tracking-[0.12em] text-mute">Thermal</div><div className="mt-1 text-sm font-medium tabular-nums text-ink">{t.temp.toFixed(1)}°</div></div>
                <div><div className="text-[9px] uppercase tracking-[0.12em] text-mute">Network</div><div className="mt-1 text-sm font-medium tabular-nums text-teal">{t.netDown.toFixed(0)} <span className="text-[9px] text-mute">KB/s</span></div></div>
              </div>
            </div>
            <div className="flex flex-col justify-between border-t border-edge pt-3 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
              <div>
                <div className="flex items-center justify-between text-[10px] text-mute"><span>{t.live ? "Memory pressure" : "Agent activity"}</span><span className="text-teal tabular-nums">{t.live ? `${t.mem.toFixed(0)}%` : `${t.tokMin.toFixed(0)} tok/min`}</span></div>
                <Sparkline data={t.tokHist} color="#7a8b8e" height={74} className="mt-2" />
              </div>
              {t.status && <div className="mt-4 space-y-1.5 border-t border-edge pt-3 text-[10px] text-mute">
                <div className="flex justify-between"><span>Available RAM</span><span className="tabular-nums text-ink/80">{t.status.mem_used_mb} / {t.status.mem_total_mb} MB used</span></div>
                <div className="flex justify-between"><span>Storage</span><span className="tabular-nums text-ink/80">{t.status.disk_used_gb} / {t.status.disk_total_gb} GB</span></div>
                <div className="flex justify-between"><span>CPU cores</span><span className="tabular-nums text-ink/80">{t.status.cores ?? "n/a"}</span></div>
              </div>}
            </div>
          </div>
        </Panel>

        <Panel title="Coming up" right={<span className="text-[10px] text-mute">{online ? `${jobs.filter((j) => j.enabled).length} enabled` : "sample schedule"}</span>}>
          <div className="divide-y divide-edge/75">
            {online ? upcoming.map((job) => (
              <div key={job.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="w-14 shrink-0 font-mono text-[10px] text-gold">{relativeTime(job.next_run_at)}</span>
                <div className="min-w-0 flex-1"><div className="truncate text-xs font-medium text-ink">{job.name}</div><div className="mt-0.5 truncate text-[10px] text-mute">{job.schedule} · {job.deliver}</div></div>
                <Led color={job.last_status === "error" || job.last_status === "failed" ? "alert" : "mint"} />
              </div>
            )) : CRON_JOBS.filter((job) => job.enabled).slice(0, 4).map((job) => (
              <div key={job.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="w-14 shrink-0 font-mono text-[10px] text-gold">{job.nextRun.split(" ").slice(-1)[0]}</span>
                <div className="min-w-0 flex-1"><div className="truncate text-xs font-medium text-ink">{job.name}</div><div className="mt-0.5 truncate text-[10px] text-mute">{job.human} · {job.delivery}</div></div>
                <Led color="mute" />
              </div>
            ))}
            {online && jobs.filter((j) => j.enabled).length === 0 && <div className="py-7 text-center text-xs text-mute">No enabled routines yet.</div>}
          </div>
        </Panel>
      </div>

      <Panel title="Recent activity" right={<button onClick={onOpenConsole} className="text-[10px] text-gold/90 hover:text-gold">Open terminal</button>}>
        <div className="divide-y divide-edge/60">
          {logs.slice(-5).reverse().map((line) => (
            <div key={line.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="shrink-0 pt-0.5 font-mono text-[9px] tabular-nums text-mute/70">{line.ts}</span>
              <span className={cn("w-9 shrink-0 pt-0.5 text-[9px] font-semibold uppercase tracking-wide", LEVEL_COLOR[line.level] ?? "text-mute")}>{line.level.slice(0, 4)}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-ink/75">{line.msg}</span>
            </div>
          ))}
          {!logs.length && <div className="py-5 text-center text-xs text-mute">Logs appear when the Hermes bridge is connected.</div>}
        </div>
      </Panel>
    </div>
  );
}