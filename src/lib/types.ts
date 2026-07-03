// Domain types — espelham as tabelas do Lovable Cloud.

export type BancadaStatus =
  | "Repouso"
  | "Injetando"
  | "Pausado"
  | "Retornando"
  | "Alivio"
  | "Offline";

export interface ValvulasEstado {
  v1: boolean;
  v2: boolean;
  v3: boolean;
  v4: boolean;
  v5: boolean;
}

export interface Configuracoes {
  tempo_injecao_segundos: number;
  tempo_pausa_segundos: number;
  tempo_retorno_segundos: number;
  tempo_alivio_segundos: number;
  /** Lista de horários (formato "HH:MM", fuso America/Sao_Paulo). */
  horarios_disparo: string[];
}

export interface Bancada {
  id: string;
  nome: string;
  status: BancadaStatus;
  ultima_sync: string | null;
  proximo_ciclo_segundos: number;
  valvulas: ValvulasEstado;
  config: Configuracoes;
  config_version: number;
  firmware_version: string | null;
  ip_local: string | null;
  temperatura_planta: number | null;
  created_at: string;
}

export type ComandoTipo = "FORCE_CYCLE" | "UPDATE_CONFIG" | "PAUSE" | "RESUME";

export interface Comando {
  id: string;
  bancada_id: string;
  tipo: ComandoTipo;
  payload: Record<string, unknown>;
  entregue_em: string | null;
  created_at: string;
}

export const DEFAULT_CONFIG: Configuracoes = {
  tempo_injecao_segundos: 150,
  tempo_pausa_segundos: 60,
  tempo_retorno_segundos: 150,
  tempo_alivio_segundos: 10,
  horarios_disparo: ["06:00", "12:00", "18:00", "00:00"],
};

export const DEFAULT_VALVULAS: ValvulasEstado = {
  v1: false,
  v2: false,
  v3: false,
  v4: false,
  v5: false,
};
