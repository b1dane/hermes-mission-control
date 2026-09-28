import { useMemo, useState } from "react";
import { SKILLS } from "../data";
import type { HermesApi } from "../api";
import { useLive } from "../hooks";
import { Badge, Panel } from "../components/ui";
import { cn } from "../utils/cn";

const SOURCE_TONE: Record<string, "gold" | "teal" | "mint"> = {
  "built-in": "teal",
  learned: "gold",
  hub: "mint",
};

interface Row {
  id: string;
  name: string;
  desc: string;
  category: string;
  version: string;
  badge: string;
  tone: "gold" | "teal" | "mint";
  meta: string;
}

export default function Skills({ api, online }: { api: HermesApi; online: boolean }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const live = useLive(online, () => api.skills(), 60000);

  const rows: Row[] = useMemo(() => {
    if (live.data) {
      return live.data.skills.map((s) => ({
        id: s.path,
        name: s.name,
        desc: s.description,
        category: s.category,
        version: s.version ?? "—",
        badge: s.category,
        tone: "teal" as const,
        meta: new Date(s.updated * 1000).toLocaleDateString(),
      }));
    }
    return SKILLS.map((s) => ({
      id: s.id,
      name: s.name,
      desc: s.desc,
      category: s.category,
      version: s.version,
      badge: s.source,
      tone: SOURCE_TONE[s.source],
      meta: `${s.uses} uses`,
    }));
  }, [live.data]);

  const cats = useMemo(() => [...new Set(rows.map((s) => s.category))], [rows]);
  const list = rows.filter((s) => (!cat || s.category === cat) && (s.name + s.desc).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-3">
      <Panel
        title="Skills · Procedural Memory"
        right={live.data ? <Badge tone="teal">{rows.length} installed</Badge> : <Badge tone="gold">{SKILLS.filter((s) => s.source === "learned").length} self-learned</Badge>}
      >
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter skills…"
            className="min-w-0 flex-1 rounded-md border border-edge bg-void/60 px-2.5 py-1.5 text-xs text-ink placeholder-mute/60 outline-none focus:border-gold/40"
          />
          <button
            onClick={() => setCat(null)}
            className={cn("rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-wider", !cat ? "border-gold/50 bg-gold/15 text-gold" : "border-edge2 text-mute")}
          >
            all
          </button>
          {cats.slice(0, 12).map((c) => (
            <button
              key={c}
              onClick={() => setCat(cat === c ? null : c)}
              className={cn("rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-wider", cat === c ? "border-gold/50 bg-gold/15 text-gold" : "border-edge2 text-mute")}
            >
              {c}
            </button>
          ))}
        </div>

        <ul className="grid gap-2 sm:grid-cols-2">
          {list.map((s) => (
            <li key={s.id} className="rounded-md border border-edge/70 bg-panel2/60 p-2.5 transition-colors hover:border-teal/30">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-bold text-teal">{s.name}</span>
                <Badge tone={s.tone}>{s.badge}</Badge>
              </div>
              <p className="mt-1 line-clamp-3 text-[10px] leading-relaxed text-ink/75">{s.desc || "—"}</p>
              <div className="mt-2 flex justify-between border-t border-edge/60 pt-1.5 text-[9px] tabular-nums text-mute">
                <span>v{s.version}</span>
                <span className="text-gold">{s.meta}</span>
              </div>
            </li>
          ))}
          {list.length === 0 && (
            <li className="col-span-full py-6 text-center text-xs text-mute">
              {live.data ? "no skills in ~/.hermes/skills — try `hermes skills browse`" : "no skills match"}
            </li>
          )}
        </ul>
        <p className="mt-3 border-t border-edge pt-2 text-[10px] text-mute">
          ⑂ Hermes saves reusable procedures automatically — install more with <span className="text-gold">hermes skills install &lt;name&gt;</span>
        </p>
      </Panel>
    </div>
  );
}
