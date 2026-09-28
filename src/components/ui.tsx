import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export function Panel({
  title,
  right,
  children,
  className,
  pad = true,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section
      className={cn(
        "glass anim-in rounded-2xl",
        className,
      )}
    >
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-white/[0.04] px-3.5 py-2.5">
          <h2 className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-mute">
            <span className="h-px w-3 bg-gold/50" />
            {title}
          </h2>
          {right}
        </header>
      )}
      <div className={pad ? "p-3.5" : undefined}>{children}</div>
    </section>
  );
}

export function Led({
  color,
  pulse,
  className,
}: {
  color: "mint" | "gold" | "alert" | "mute" | "teal" | "warn";
  pulse?: boolean;
  className?: string;
}) {
  const map = {
    mint: "bg-mint text-mint",
    gold: "bg-gold text-gold",
    alert: "bg-alert text-alert",
    mute: "bg-mute text-mute",
    teal: "bg-teal text-teal",
    warn: "bg-warn text-warn",
  };
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        map[color],
        pulse && "led-pulse",
        className,
      )}
    />
  );
}

export function Badge({
  children,
  tone = "mute",
  className,
}: {
  children: ReactNode;
  tone?: "gold" | "teal" | "mint" | "alert" | "warn" | "mute";
  className?: string;
}) {
  const map = {
    gold: "border-gold/25 bg-gold/[0.06] text-gold",
    teal: "border-teal/25 bg-teal/[0.06] text-teal",
    mint: "border-mint/25 bg-mint/[0.06] text-mint",
    alert: "border-alert/25 bg-alert/[0.06] text-alert",
    warn: "border-warn/25 bg-warn/[0.06] text-warn",
    mute: "border-white/[0.06] bg-white/[0.02] text-mute",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-medium uppercase tracking-[0.12em]",
        map[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Sparkline({
  data,
  color = "#7a8b8e",
  height = 36,
  fill = true,
  className,
}: {
  data: number[];
  color?: string;
  height?: number;
  fill?: boolean;
  className?: string;
}) {
  const w = 200;
  const max = Math.max(...data) * 1.1 || 1;
  const min = Math.min(...data) * 0.9;
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className={cn("h-9 w-full", className)}
      style={{ height }}
    >
      {fill && (
        <polygon
          points={`0,${height} ${pts.join(" ")} ${w},${height}`}
          fill={color}
          opacity={0.12}
        />
      )}
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <circle
        cx={w}
        cy={pts.length ? Number(pts[pts.length - 1].split(",")[1]) : 0}
        r={2.4}
        fill={color}
      />
    </svg>
  );
}

export function Meter({
  value,
  label,
  suffix = "%",
  tone,
}: {
  value: number;
  label: string;
  suffix?: string;
  tone?: "gold" | "teal" | "mint" | "alert";
}) {
  const auto =
    value > 85 ? "bg-alert/80" : value > 65 ? "bg-warn/80" : tone === "gold" ? "bg-gold/80" : "bg-teal/80";
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[10px]">
        <span className="uppercase tracking-[0.16em] text-mute">{label}</span>
        <span className="font-medium text-ink tabular-nums">
          {value.toFixed(0)}
          <span className="text-mute">{suffix}</span>
        </span>
      </div>
      <div className="h-px overflow-visible rounded-none bg-white/[0.06]">
        <div
          className={cn("h-px transition-all duration-700", auto)}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}

export function Toggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
        on ? "border-gold/40 bg-gold/15" : "border-white/10 bg-white/[0.04]",
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-all",
          on ? "left-[18px] bg-gold" : "left-[3px] bg-mute",
        )}
      />
    </button>
  );
}

export function Stat({
  label,
  value,
  sub,
  accent = "text-ink",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
}) {
  return (
    <div className="border-l border-white/[0.06] px-3.5 py-1 first:border-0 first:pl-0">
      <div className="text-[9px] font-medium uppercase tracking-[0.16em] text-mute">{label}</div>
      <div className={cn("mt-1.5 text-2xl font-semibold tabular-nums tracking-tight", accent)}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-mute">{sub}</div>}
    </div>
  );
}
