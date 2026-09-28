import { useEffect, useState } from "react";
import { LOG_POOL, type LogLine } from "./data";
import { useAgentLink, useClock, useLive, useTelemetry, useUptime } from "./hooks";
import { Badge, Led } from "./components/ui";
import { cn } from "./utils/cn";
import Overview from "./views/Overview";
import Sessions from "./views/Sessions";
import Automations from "./views/Automations";
import Skills from "./views/Skills";
import Console from "./views/Console";
import Chat from "./views/Chat";
import Mcp from "./views/Mcp";
import Settings, { usePrefs } from "./views/Settings";

type Tab = "overview" | "chat" | "mcp" | "sessions" | "cron" | "skills" | "console" | "settings";

const TABS: Array<{ id: Tab; label: string; glyph: string }> = [
  { id: "overview", label: "Overview", glyph: "◌" },
  { id: "chat", label: "Chat", glyph: "☤" },
  { id: "mcp", label: "MCP", glyph: "⌘" },
  { id: "sessions", label: "Sessions", glyph: "▤" },
  { id: "cron", label: "Routines", glyph: "◷" },
  { id: "skills", label: "Skills", glyph: "◇" },
  { id: "console", label: "Terminal", glyph: ">_" },
  { id: "settings", label: "Settings", glyph: "S" },
];

const MOBILE_TABS: Tab[] = ["overview", "chat", "mcp", "cron"];
const MORE_TABS: Tab[] = ["sessions", "skills", "console", "settings"];

let logSeq = 0;
function makeLog(): LogLine {
  const p = LOG_POOL[Math.floor(Math.random() * LOG_POOL.length)];
  const d = new Date();
  const ts = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
  return { id: ++logSeq, ts, ...p };
}

export default function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const [moreOpen, setMoreOpen] = useState(false);
  const [prefs, setPrefs] = usePrefs();
  const { api, state: link, latency, health, error } = useAgentLink(prefs.endpoint, prefs.token);
  const online = link === "online";
  const t = useTelemetry(api, online);
  const clock = useClock();
  const uptime = useUptime(t.status?.uptime_s ?? null);

  const [demoLogs, setDemoLogs] = useState<LogLine[]>(() => Array.from({ length: 14 }, makeLog));
  useEffect(() => {
    if (online) return;
    const id = setInterval(() => setDemoLogs((p) => [...p.slice(-160), makeLog()]), 2600);
    return () => clearInterval(id);
  }, [online]);

  const liveTail = useLive(online, () => api.logs(40), 6000);
  const logs: LogLine[] = liveTail.data
    ? liveTail.data.lines.map((l, i) => ({ id: i, ts: l.ts, level: l.level as LogLine["level"], source: l.source, msg: l.msg }))
    : demoLogs;
  const clockStr = clock.toLocaleTimeString([], { hour12: false });
  const dateStr = clock.toLocaleDateString([], { weekday: "short", month: "short", day: "2-digit" }).toUpperCase();
  const h = t.status?.hermes;

  const changeTab = (next: Tab) => {
    setTab(next);
    setMoreOpen(false);
  };
  const itemFor = (id: Tab) => TABS.find((entry) => entry.id === id)!;

  return (
    <div className={cn("grid-bg min-h-dvh", prefs.scanlines && "scanlines", prefs.compact && "text-[95%]")}>
      <header className="sticky top-0 z-50 border-b border-white/[0.04] bg-void/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg border border-white/[0.08] bg-panel2 text-base text-gold/90">
              ☤
            </span>
            <div className="leading-tight">
              <div className="text-[12px] font-medium tracking-[0.18em] text-ink">HERMES <span className="text-gold/85">MISSION CONTROL</span></div>
              <div className="mt-0.5 hidden text-[9px] tracking-[0.15em] text-mute/80 sm:block">
                {health?.termux ? "TERMUX · ANDROID" : "PRIVATE LOCAL NODE"} {health?.version ? `· v${health.version}` : ""}
              </div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3 sm:gap-5">
            <button onClick={() => changeTab("settings")} title="Agent link" className="transition hover:opacity-80">
              {online ? <Badge tone="mint"><Led color="mint" pulse /> CONNECTED</Badge> : link === "probing" ? <Badge tone="warn"><Led color="warn" pulse /> PROBE</Badge> : <Badge tone="gold"><Led color="gold" pulse /> DEMO</Badge>}
            </button>
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-[11px] font-medium tabular-nums text-ink">{clockStr}</div>
              <div className="text-[9px] tracking-[0.14em] text-mute">{dateStr}</div>
            </div>
            <div className="hidden border-l border-edge pl-4 text-right leading-tight md:block">
              <div className="text-[11px] font-medium tabular-nums text-teal">{uptime}</div>
              <div className="text-[9px] tracking-[0.14em] text-mute">{online ? "DEVICE UPTIME" : "SESSION"}</div>
            </div>
          </div>
        </div>

        <div className="border-t border-white/[0.045] bg-panel/35">
          <div className="mx-auto flex max-w-7xl items-center gap-4 overflow-x-auto px-4 py-1.5 text-[9px] tracking-[0.1em] text-mute sm:px-6 [scrollbar-width:none]">
            {online ? (
              <>
                <span className="flex shrink-0 items-center gap-1.5"><Led color={h?.gateway_running ? "mint" : "alert"} pulse /> AGENT <span className={h?.gateway_running ? "text-mint" : "text-alert"}>{h?.gateway_running ? "RUNNING" : "IDLE"}</span></span>
                <span className="shrink-0">MODEL <span className="text-ink/80">{h?.model?.toUpperCase() ?? "DEFAULT"}</span></span>
                <span className="shrink-0">CPU <span className="text-teal tabular-nums">{t.cpu.toFixed(0)}%</span></span>
                <span className="shrink-0">BATTERY <span className="text-ink/80 tabular-nums">{t.battery.toFixed(0)}%</span></span>
                <span className="hidden shrink-0 sm:inline">SCHEDULED <span className="text-gold tabular-nums">{h?.cron_enabled}/{h?.cron_total}</span></span>
                <span className="hidden shrink-0 md:inline">LATENCY <span className="text-teal tabular-nums">{latency}ms</span></span>
              </>
            ) : (
              <>
                <span className="flex shrink-0 items-center gap-1"><Led color="gold" pulse /> LOCAL PREVIEW <span className="text-gold">bridge offline</span></span>
                <span className="shrink-0">DEVICE TELEMETRY SIMULATED</span>
                <span className="hidden shrink-0 sm:inline">START <span className="font-mono text-ink">python server/hermes_mc.py</span></span>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 pb-24 pt-5 sm:px-6 lg:pb-8">
        <nav className="sticky top-[112px] hidden h-fit w-44 shrink-0 flex-col gap-1.5 lg:flex">
          {TABS.map((item) => (
            <button key={item.id} onClick={() => changeTab(item.id)} className={cn("group flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-[11px] font-medium transition-colors", tab === item.id ? "rail-active border-transparent bg-white/[0.03] text-ink" : "border-transparent text-mute hover:bg-white/[0.02] hover:text-ink")}>
              <span className={cn("w-5 text-center text-sm transition-colors", tab === item.id ? "text-gold" : "text-mute/70 group-hover:text-ink")}>{item.glyph}</span>
              {item.label}
            </button>
          ))}
          <div className="mt-5 border-t border-edge px-2 pt-4 text-[10px] leading-relaxed text-mute">
            <div className="mb-1.5 flex items-center gap-1.5 text-ink/80"><Led color={online ? "mint" : "gold"} pulse /> {online ? "LOCAL CONNECTION" : "LOCAL PREVIEW"}</div>
            {online ? <>Bridge at <span className="text-ink/80">{prefs.endpoint.replace(/^https?:\/\//, "")}</span> drives the Hermes CLI on this device.</> : <>Run <span className="font-mono text-ink/80">python server/hermes_mc.py</span> in Termux to connect your agent.</>}
          </div>
        </nav>

        <main className="min-w-0 flex-1">
          {tab === "overview" && <Overview api={api} online={online} t={t} logs={logs} onOpenConsole={() => changeTab("console")} />}
          {tab === "chat" && <Chat api={api} online={online} />}
          {tab === "mcp" && <Mcp api={api} online={online} />}
          {tab === "sessions" && <Sessions api={api} online={online} />}
          {tab === "cron" && <Automations api={api} online={online} />}
          {tab === "skills" && <Skills api={api} online={online} />}
          {tab === "console" && <Console api={api} online={online} t={t} logs={logs} />}
          {tab === "settings" && <Settings prefs={prefs} setPrefs={setPrefs} link={link} latency={latency} health={health} error={error} />}
        </main>
      </div>

      {moreOpen && <button aria-label="Close navigation" onClick={() => setMoreOpen(false)} className="fixed inset-0 z-40 bg-black/40 lg:hidden" />}
      {moreOpen && (
        <div className="fixed inset-x-3 bottom-[calc(4.8rem+env(safe-area-inset-bottom))] z-50 rounded-2xl border border-edge bg-panel/95 p-2 shadow-2xl backdrop-blur-xl lg:hidden">
          {MORE_TABS.map((id) => <button key={id} onClick={() => changeTab(id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs text-ink hover:bg-white/[0.04]"><span className="w-5 text-center text-gold">{itemFor(id).glyph}</span>{itemFor(id).label}</button>)}
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-white/[0.04] bg-void/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid max-w-7xl grid-cols-5 px-2">
          {MOBILE_TABS.map((id) => (
            <button key={id} onClick={() => changeTab(id)} className={cn("flex flex-col items-center gap-1 py-2 text-[9px] font-medium transition-colors", tab === id ? "text-gold" : "text-mute")}>
              <span className="text-base leading-none">{itemFor(id).glyph}</span>{itemFor(id).label}
            </button>
          ))}
          <button onClick={() => setMoreOpen((p) => !p)} className={cn("flex flex-col items-center gap-1 py-2 text-[9px] font-medium transition-colors", moreOpen || MORE_TABS.includes(tab) ? "text-gold" : "text-mute")}>
            <span className="text-base leading-none">...</span>More
          </button>
        </div>
      </nav>
    </div>
  );
}