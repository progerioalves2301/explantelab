// Domain types — espelham as tabelas do Lovable Cloud.

export type BancadaStatus =
  | "Repouso"
  | "Injetando"
  | "Pausado"
  | "Retornando"
  | "Alivio"
  | "Manual"
  | "Offline";

export interface ValvulasEstado {
  v1: boolean;
  v2: boolean;
  v3: boolean;
  v4: boolean;
  v5: boolean;
}

export interface LuzJanela {
  /** Horário de ligar as luzes ("HH:MM", fuso America/Sao_Paulo). */
  ligar: string;
  /** Horário de desligar as luzes ("HH:MM", fuso America/Sao_Paulo). */
  desligar: string;
}

export interface Configuracoes {
  tempo_injecao_segundos: number;
  tempo_pausa_segundos: number;
  tempo_retorno_segundos: number;
  tempo_alivio_segundos: number;
  /** Lista de horários de disparo do ciclo (formato "HH:MM"). */
  horarios_disparo: string[];
  /** Janelas do timer das luzes (cada item = par ligar/desligar). */
  luz_janelas: LuzJanela[];
}

export interface Laboratorio {
  id: string;
  nome: string;
  descricao: string | null;
  cor: string;
  ordem: number;
  created_at: string;
}

export interface Bancada {
  id: string;
  nome: string;
  status: BancadaStatus;
  ultima_sync: string | null;
  status_desde: string | null;
  proximo_ciclo_segundos: number;
  valvulas: ValvulasEstado;
  config: Configuracoes;
  config_version: number;
  firmware_version: string | null;
  ip_local: string | null;
  temperatura_planta: number | null;
  temp_min: number | null;
  temp_max: number | null;
  offline_threshold_segundos: number;
  laboratorio_id: string | null;
  posicao: number | null;
  luz_ligada: boolean;
  created_at: string;
}

export type ComandoTipo =
  | "FORCE_CYCLE"
  | "UPDATE_CONFIG"
  | "PAUSE"
  | "RESUME"
  | "SET_VALVE";

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
  luz_janelas: [{ ligar: "06:00", desligar: "18:00" }],
};

export const DEFAULT_VALVULAS: ValvulasEstado = {
  v1: false,
  v2: false,
  v3: false,
  v4: false,
  v5: false,
};
