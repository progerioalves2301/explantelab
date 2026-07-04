export function formatShortDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM ? `${h}h${String(remM).padStart(2, "0")}` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d${remH}h` : `${d}d`;
}

import type { Bancada } from "./types";

/** Retorna há quanto tempo (ms) a bancada está no estado atual. */
export function tempoNoEstado(bancada: Bancada, now = Date.now()): number {
  if (bancada.status === "Offline") {
    // Se ficamos offline por cálculo, contamos a partir de ultima_sync + threshold.
    if (bancada.ultima_sync) {
      const limite =
        new Date(bancada.ultima_sync).getTime() +
        (bancada.offline_threshold_segundos ?? 300) * 1000;
      return Math.max(0, now - limite);
    }
    return 0;
  }
  const base = bancada.status_desde ?? bancada.ultima_sync;
  if (!base) return 0;
  return Math.max(0, now - new Date(base).getTime());
}
