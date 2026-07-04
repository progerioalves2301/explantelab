import type { Bancada } from "./types";

export function withComputedBancadaStatus(
  bancada: Bancada,
  now = Date.now(),
): Bancada {
  const limite = (bancada.offline_threshold_segundos ?? 300) * 1000;
  const ultimaSync = bancada.ultima_sync
    ? new Date(bancada.ultima_sync).getTime()
    : Number.NaN;
  const semSync = !Number.isFinite(ultimaSync);
  const expirou = Number.isFinite(ultimaSync) && now - ultimaSync > limite;

  if (semSync || expirou) {
    return { ...bancada, status: "Offline" };
  }

  return bancada;
}

export function withComputedBancadasStatus(
  bancadas: Bancada[],
  now = Date.now(),
): Bancada[] {
  return bancadas.map((bancada) => withComputedBancadaStatus(bancada, now));
}