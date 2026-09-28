import { useState } from "react";
import { MEMORY, SESSIONS } from "../data";
import type { HermesApi } from "../api";
import { useLive } from "../hooks";
import { Badge, Led, Panel } from "../components/ui";
import { cn } from "../utils/cn";

const PLATFORM_GLYPH: Record<string, string> = {
  cli: ">_",
  telegram: "✈",
  discord: "◈",
  cron: "⏱",
  subagent: "⑂",
  oneshot: "•",
  tool: "⚙",
  slack: "♯",
  whatsapp: "☏",
};

const KIND_TONE: Record<string, "gold" | "teal" | "mint" | "warn"> = {
  fact: "teal",
  preference: "gold",
  project: "mint",
  person: "warn",
};

function fmtTs(v: string | number | null) {
  if (v == null) return "—";
  const d = typeof v === "number" ? new Date(v > 1e12 ? v : v * 1000) : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function Sessions({ api, online }: { api: HermesApi; online: boolean }) {
  const sess = useLive(online, () => api.sessions(), 20000);
  const mem = useLive(online, () => api.memory(), 60000);
  const [openMem, setOpenMem] = useState<string | null>(null);

  const live = sess.data;

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Panel
        title="Sessions"
        className="lg:col-span-2"
        right={
          live ? (
            <Badge tone="teal">{live.total} total · {live.source}</Badge>
          ) : (
            <Badge tone="mint">{SESSIONS.filter((s) => s.status === "active").length} ACTIVE</Badge>
          )
        }
      >
        {live ? (
          live.sessions.length ? (
            <ul className="space-y-2">
              {live.sessions.map((s) => (
                <li key={s.id} className="rounded-md border border-edge/70 bg-panel2/60 p-2.5 transition-colors hover:border-gold/30">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="w-6 shrink-0 text-center text-xs text-gold-dim">{PLATFORM_GLYPH[s.source] ?? "•"}</span>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-ink">{s.title}</div>
                        <div className="truncate text-[10px] text-mute">
                          {s.id.slice(0, 12)} · {s.model ?? "default model"} · {s.source}
                        </div>
                      </div>
                    </div>
                    <Led color={s.ended ? "mute" : "mint"} pulse={!s.ended} className="mt-1" />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-edge/60 pt-1.5 text-[10px] tabular-nums text-mute">
                    <span><span className="text-teal">{(Number(s.tokens) / 1000).toFixed(1)}k</span> tokens</span>
                    <span><span className="text-gold">${Number(s.cost).toFixed(3)}</span></span>
                    <span><span className="text-ink">{s.messages}</span> msgs</span>
                    <span className="ml-auto">{fmtTs(s.ended ?? s.started)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-6 text-center text-[11px] text-mute">
              no sessions found
              {live.raw && <pre className="mt-3 max-h-48 overflow-auto rounded border border-edge bg-void/60 p-2 text-left text-[10px] text-ink/70">{live.raw}</pre>}
            </div>
          )
        ) : (
          <ul className="space-y-2">
            {SESSIONS.map((s) => (
              <li key={s.id} className="rounded-md border border-edge/70 bg-panel2/60 p-2.5 transition-colors hover:border-gold/30">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-6 shrink-0 text-center text-xs text-gold-dim">{PLATFORM_GLYPH[s.platform]}</span>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold text-ink">{s.title}</div>
                      <div className="text-[10px] text-mute">{s.id} · {s.model} · started {s.startedAt}</div>
                    </div>
                  </div>
                  <Led color={s.status === "active" ? "mint" : s.status === "idle" ? "warn" : "mute"} pulse={s.status === "active"} className="mt-1" />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-edge/60 pt-1.5 text-[10px] tabular-nums text-mute">
                  <span><span className="text-teal">{(s.tokens / 1000).toFixed(1)}k</span> tokens</span>
                  <span><span className="text-gold">${s.cost.toFixed(2)}</span> cost</span>
                  <span><span className="text-ink">{s.messages}</span> msgs</span>
                  <span className="ml-auto">{s.lastActivity}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Layered Memory" right={<Badge tone="teal">{mem.data ? `${mem.data.files.length} files` : `${MEMORY.length} entries`}</Badge>}>
        {mem.data ? (
          mem.data.files.length ? (
            <ul className="space-y-2">
              {mem.data.files.map((f) => {
                const open = openMem === f.name;
                return (
                  <li key={f.path} className="rounded-md border border-edge/70 bg-panel2/60">
                    <button onClick={() => setOpenMem(open ? null : f.name)} className="flex w-full items-center justify-between px-2.5 py-2 text-left">
                      <span className="text-xs font-bold text-gold">{f.name}</span>
                      <span className="text-[9px] text-mute">
                        {(f.content.length / 1024).toFixed(1)} KB · {open ? "▾" : "▸"}
                      </span>
                    </button>
                    <pre
                      className={cn(
                        "overflow-auto whitespace-pre-wrap border-t border-edge/60 px-2.5 py-2 text-[10px] leading-relaxed text-ink/80",
                        open ? "max-h-[50dvh]" : "max-h-20",
                      )}
                    >
                      {f.content || "(empty)"}
                    </pre>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="py-6 text-center text-[11px] text-mute">no memory files yet — Hermes writes MEMORY.md as it learns</div>
          )
        ) : (
          <ul className="space-y-2">
            {MEMORY.map((m) => (
              <li key={m.id} className="rounded-md border border-edge/70 bg-panel2/60 p-2.5">
                <div className="flex items-center justify-between">
                  <Badge tone={KIND_TONE[m.kind]}>{m.kind}</Badge>
                  <span className="text-[9px] text-mute">{m.updated}</span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink/85">{m.content}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 border-t border-edge pt-2 text-[10px] text-mute">
          ◈ Files under <span className="text-gold">~/.hermes/memories</span> — edit with <span className="text-gold">hermes memory</span> or in chat.
        </p>
      </Panel>
    </div>
  );
}
