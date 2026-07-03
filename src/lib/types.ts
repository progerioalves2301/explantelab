// Domain types — mirrors planned Supabase tables.
// Tables: bancadas, valvulas_estado, configuracoes.

export type BancadaStatus =
  | "Repouso"
  | "Injetando"
  | "Pausado"
  | "Retornando"
  | "Offline";

export interface ValvulasEstado {
  v1: boolean;
  v2: boolean;
  v3: boolean;
  v4: boolean;
}

export interface Configuracoes {
  tempo_injecao_segundos: number;
  tempo_pausa_segundos: number;
  tempo_retorno_segundos: number;
  intervalo_ciclo_horas: number;
}

export interface Bancada {
  id: number;
  nome: string;
  status: BancadaStatus;
  ultima_sync: string; // ISO timestamp
  proximo_ciclo_segundos: number;
  valvulas: ValvulasEstado;
  config: Configuracoes;
}
