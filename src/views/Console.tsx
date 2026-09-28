import { useEffect, useRef, useState } from "react";
import { CHANNELS, CMD_HELP, CRON_JOBS, SESSIONS, SKILLS, type LogLine } from "../data";
import type { HermesApi } from "../api";
import { useLive, type Telemetry } from "../hooks";
import { Badge, Led, Panel } from "../components/ui";
import { cn } from "../utils/cn";

const LEVEL_COLOR: Record<string, string> = {
  info: "text-mute",
  warn: "text-warn",
  error: "text-alert",
  tool: "text-teal",
  cron: "text-gold",
  agent: "text-ink",
  debug: "text-mute/60",
};

interface TermLine {
  id: number;
  kind: "in" | "out" | "err" | "sys";
  text: string;
}

let lineId = 1000;

const QUICK = ["hermes status", "hermes --version", "hermes cron list", "hermes cron status", "hermes skills list", "hermes sessions list", "hermes doctor", "hermes insights --days 7", "hermes usage"];

export default function Console({ api, online, t, logs }: { api: HermesApi; online: boolean; t: Telemetry; logs: LogLine[] }) {
  const [lines, setLines] = useState<TermLine[]>([
    { id: 1, kind: "sys", text: online ? "Bridge linked — commands run the real `hermes` CLI on this device. Type 'help'." : "Demo console — connect the Python bridge to run real hermes commands. Type 'help'." },
  ]);
  const [input, setInput] = useState("");
  const [hist, setHist] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [logFile, setLogFile] = useState("agent");
  const logEnd = useRef<HTMLDivElement>(null);
  const termEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const liveLogs = useLive(online && !paused, () => api.logs(250, logFile), 4000, [logFile]);

  useEffect(() => {
    if (!paused) logEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, liveLogs.data, paused]);

  useEffect(() => {
    termEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const push = (kind: TermLine["kind"], text: string) => setLines((p) => [...p, { id: ++lineId, kind, text }]);

  const runDemo = (cmd: string) => {
    if (cmd === "status") {
      push("out", `agent      ONLINE · loop healthy (simulated)`);
      push("out", `cpu ${t.cpu.toFixed(0)}%  mem ${t.mem.toFixed(0)}%  batt ${t.battery.toFixed(0)}%${t.charging ? " ⚡" : ""}  temp ${t.temp.toFixed(1)}°C`);
      return true;
    }
    if (cmd === "sessions") return SESSIONS.forEach((s) => push("out", `  ${s.id}  [${s.status.padEnd(8)}] ${s.title}`)), true;
    if (cmd === "cron list" || cmd === "cron") return CRON_JOBS.forEach((j) => push("out", `  ${j.enabled ? "●" : "○"} ${j.expr.padEnd(12)} ${j.name} → ${j.delivery}`)), true;
    if (cmd === "skills") return SKILLS.forEach((s) => push("out", `  ${s.name.padEnd(28)} v${s.version} (${s.source})`)), true;
    if (cmd === "gateway") return CHANNELS.forEach((c) => push("out", `  ${c.name.padEnd(16)} ${c.status.toUpperCase()}`)), true;
    if (cmd === "model") return push("out", "  model      Hermes-4-405B (simulated)"), true;
    if (cmd === "mem") return push("out", "  layered store: 5 hot entries (simulated)"), true;
    return false;
  };

  const run = async (raw: string) => {
    const cmd = raw.trim();
    push("in", raw);
    if (!cmd) return;
    setHist((p) => [raw, ...p]);
    setHistIdx(-1);
    const lower = cmd.toLowerCase();
    if (lower === "clear") return setLines([]);
    if (lower === "help") {
      push("out", online ? "any non-interactive hermes subcommand works, e.g.:" : "demo commands:");
      (online ? QUICK.map((q) => "  " + q) : CMD_HELP).forEach((l) => push("out", l));
      return;
    }
    if (!online) {
      const stripped = lower.replace(/^hermes\s+/, "");
      if (!runDemo(stripped)) push("err", `demo mode: '${cmd}' — connect the bridge for real execution`);
      return;
    }
    setRunning(true);
    try {
      const r = await api.exec(cmd);
      if (r.stdout.trim()) push("out", r.stdout.trimEnd());
      if (r.stderr.trim()) push(r.ok ? "sys" : "err", r.stderr.trimEnd());
      if (!r.stdout.trim() && !r.stderr.trim()) push("sys", `(no output) exit ${r.code}`);
      else if (!r.ok) push("sys", `exit ${r.code} · ${r.duration_ms ?? 0}ms`);
    } catch (e) {
      push("err", `bridge error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !running) {
      run(input);
      setInput("");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const i = Math.min(histIdx + 1, hist.length - 1);
      if (hist[i]) {
        setHistIdx(i);
        setInput(hist[i]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const i = histIdx - 1;
      setHistIdx(i);
      setInput(i >= 0 ? hist[i] : "");
    }
  };

  const logRows = liveLogs.data ? liveLogs.data.lines : logs.map((l) => ({ ts: l.ts, level: l.level, source: l.source, msg: l.msg }));

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* logs */}
      <Panel
        title={liveLogs.data?.file ? `~/.hermes/logs/${liveLogs.data.file}` : "Structured Logs"}
        pad={false}
        right={
          <div className="flex items-center gap-2">
            {liveLogs.data && liveLogs.data.files.length > 1 && (
              <select
                value={logFile}
                onChange={(e) => setLogFile(e.target.value)}
                className="rounded border border-edge bg-panel2 px-1 py-0.5 text-[9px] text-ink outline-none"
              >
                {liveLogs.data.files.map((f) => (
                  <option key={f} value={f.replace(/\.log$/, "")}>
                    {f}
                  </option>
                ))}
              </select>
            )}
            <button onClick={() => setPaused((p) => !p)} className={cn("text-[9px] font-bold uppercase tracking-widest", paused ? "text-warn" : "text-mute hover:text-ink")}>
              {paused ? "▶ resume" : "⏸ pause"}
            </button>
          </div>
        }
      >
        <div className="h-[46dvh] overflow-y-auto p-3 lg:h-[62dvh]">
          <ul className="space-y-1 text-[10px] leading-relaxed">
            {logRows.map((l, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="shrink-0 tabular-nums text-mute/50">{l.ts}</span>
                <span className={cn("w-9 shrink-0 font-bold uppercase", LEVEL_COLOR[l.level] ?? "text-mute")}>{l.level.slice(0, 4)}</span>
                <span className="max-w-[30%] shrink-0 truncate text-gold-dim">{l.source}</span>
                <span className="break-all text-ink/80">{l.msg}</span>
              </li>
            ))}
            {logRows.length === 0 && <li className="py-6 text-center text-mute">no log lines — ~/.hermes/logs is empty</li>}
          </ul>
          <div ref={logEnd} />
        </div>
      </Panel>

      {/* terminal */}
      <Panel
        title="Command Console"
        pad={false}
        right={
          <Badge tone={online ? "mint" : "gold"}>
            <Led color={online ? "mint" : "gold"} pulse /> {online ? "hermes cli" : "demo tty"}
          </Badge>
        }
      >
        <div className="flex h-[46dvh] flex-col lg:h-[62dvh]" onClick={() => inputRef.current?.focus()}>
          <div className="flex gap-1 overflow-x-auto border-b border-edge px-2 py-1.5 [scrollbar-width:none]">
            {QUICK.map((q) => (
              <button
                key={q}
                disabled={running}
                onClick={(e) => {
                  e.stopPropagation();
                  run(q);
                }}
                className="shrink-0 rounded border border-edge2 bg-panel2 px-2 py-0.5 text-[9px] text-mute hover:border-gold/40 hover:text-gold disabled:opacity-40"
              >
                {q.replace(/^hermes /, "")}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <ul className="space-y-0.5 text-[11px] leading-relaxed">
              {lines.map((l) => (
                <li key={l.id} className="whitespace-pre-wrap break-words">
                  {l.kind === "in" ? (
                    <span>
                      <span className="text-gold">hermes ☤ </span>
                      <span className="text-ink">{l.text}</span>
                    </span>
                  ) : l.kind === "sys" ? (
                    <span className="text-mute italic">{l.text}</span>
                  ) : l.kind === "err" ? (
                    <span className="text-alert">{l.text}</span>
                  ) : (
                    <span className="text-teal/90">{l.text}</span>
                  )}
                </li>
              ))}
              {running && <li className="text-mute italic">running…</li>}
            </ul>
            <div ref={termEnd} />
          </div>
          <div className="flex items-center gap-2 border-t border-edge px-3 py-2.5">
            <span className="text-gold">☤</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder={online ? "hermes status" : "type a command…"}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full bg-transparent text-[11px] text-ink placeholder-mute/50 outline-none"
            />
            <span className="caret-blink text-gold">▊</span>
          </div>
        </div>
      </Panel>
    </div>
  );
}
