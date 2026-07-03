import type { Bancada, BancadaStatus, ValvulasEstado } from "./types";

// TODO(Supabase): substituir por
//   const { data } = await supabase.from('bancadas').select('*, valvulas_estado(*), configuracoes(*)')
// e assinar realtime:
//   supabase.channel('bancadas').on('postgres_changes',
//     { event: 'UPDATE', schema: 'public', table: 'bancadas' }, handler).subscribe()

const statuses: BancadaStatus[] = [
  "Injetando",
  "Repouso",
  "Retornando",
  "Pausado",
  "Repouso",
  "Injetando",
  "Offline",
  "Repouso",
];

function valvesFor(status: BancadaStatus): ValvulasEstado {
  switch (status) {
    case "Injetando":
      return { v1: true, v2: false, v3: false, v4: true };
    case "Retornando":
      return { v1: false, v2: true, v3: true, v4: false };
    default:
      return { v1: false, v2: false, v3: false, v4: false };
  }
}

export const MOCK_BANCADAS: Bancada[] = statuses.map((status, i) => ({
  id: i + 1,
  nome: `Bancada ${String(i + 1).padStart(2, "0")}`,
  status,
  ultima_sync: new Date(Date.now() - (10 + i * 3) * 1000).toISOString(),
  proximo_ciclo_segundos: 3600 * 2 + i * 137,
  valvulas: valvesFor(status),
  config: {
    tempo_injecao_segundos: 150,
    tempo_pausa_segundos: 60,
    tempo_retorno_segundos: 150,
    intervalo_ciclo_horas: 4,
  },
}));

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

export function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff} seg atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min atrás`;
  return `${Math.floor(diff / 3600)} h atrás`;
}
