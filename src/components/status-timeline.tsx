import type { BancadaStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const colorFor: Record<BancadaStatus, string> = {
  Injetando: "bg-leaf",
  Retornando: "bg-fluid",
  Alivio: "bg-warn",
  Repouso: "bg-idle",
  Pausado: "bg-warn",
  Manual: "bg-primary",
  Offline: "bg-destructive",
};

export interface StatusSegment {
  status: BancadaStatus;
  start: number;
  end: number;
}

export function StatusTimeline({
  segments,
  now = Date.now(),
  windowMs = 24 * 3600 * 1000,
  className,
}: {
  segments: StatusSegment[];
  now?: number;
  windowMs?: number;
  className?: string;
}) {
  const from = now - windowMs;
  const total = now - from;
  return (
    <div
      className={cn(
        "flex h-1.5 w-full overflow-hidden rounded-full bg-muted/60",
        className,
      )}
      aria-label="Status nas últimas 24h"
    >
      {segments.map((s, i) => {
        const start = Math.max(s.start, from);
        const end = Math.min(s.end, now);
        if (end <= start) return null;
        const w = ((end - start) / total) * 100;
        return (
          <div
            key={i}
            className={colorFor[s.status] ?? "bg-muted"}
            style={{ width: `${w}%` }}
            title={`${s.status} — ${new Date(start).toLocaleTimeString()}`}
          />
        );
      })}
    </div>
  );
}

/**
 * Constrói segmentos [start,end] em ordem crescente cobrindo `now-windowMs` até `now`.
 * `logs` deve vir ordenado ASC por changed_at.
 * `computedNow` é o status atual efetivo (pode divergir do último log — ex: Offline calculado).
 */
export function buildSegments(
  logs: { status: string; changed_at: string }[],
  computedNow: BancadaStatus,
  now = Date.now(),
  windowMs = 24 * 3600 * 1000,
): StatusSegment[] {
  const from = now - windowMs;
  const points = logs
    .map((l) => ({
      status: l.status as BancadaStatus,
      t: new Date(l.changed_at).getTime(),
    }))
    .sort((a, b) => a.t - b.t);

  // status "corrente" no início da janela: último status antes de `from`
  let baseline: BancadaStatus | null = null;
  const inWindow: typeof points = [];
  for (const p of points) {
    if (p.t <= from) baseline = p.status;
    else inWindow.push(p);
  }

  const segs: StatusSegment[] = [];
  let cursor = from;
  let current: BancadaStatus | null = baseline;

  for (const p of inWindow) {
    if (current) segs.push({ status: current, start: cursor, end: p.t });
    cursor = p.t;
    current = p.status;
  }
  // último segmento até agora — usa o status computado (para refletir Offline JS)
  segs.push({ status: computedNow, start: cursor, end: now });
  return segs;
}
