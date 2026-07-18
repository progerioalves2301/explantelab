export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alerta_destinos: {
        Row: {
          ativo: boolean
          chat_id: string
          created_at: string
          id: string
          nome: string
        }
        Insert: {
          ativo?: boolean
          chat_id: string
          created_at?: string
          id?: string
          nome: string
        }
        Update: {
          ativo?: boolean
          chat_id?: string
          created_at?: string
          id?: string
          nome?: string
        }
        Relationships: []
      }
      alertas: {
        Row: {
          bancada_id: string
          created_at: string
          id: string
          mensagem: string
          notificado_em: string | null
          notificado_resolucao_em: string | null
          resolvido_em: string | null
          severidade: string
          tipo: string
          valor: Json
        }
        Insert: {
          bancada_id: string
          created_at?: string
          id?: string
          mensagem: string
          notificado_em?: string | null
          notificado_resolucao_em?: string | null
          resolvido_em?: string | null
          severidade?: string
          tipo: string
          valor?: Json
        }
        Update: {
          bancada_id?: string
          created_at?: string
          id?: string
          mensagem?: string
          notificado_em?: string | null
          notificado_resolucao_em?: string | null
          resolvido_em?: string | null
          severidade?: string
          tipo?: string
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "alertas_bancada_id_fkey"
            columns: ["bancada_id"]
            isOneToOne: false
            referencedRelation: "bancadas"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      ar_condicionados: {
        Row: {
          agregacao: string
          ativo: boolean
          bancada_controladora_id: string | null
          codigo_ir_raw: Json | null
          codigo_ir_raw_heat: Json | null
          created_at: string
          histerese: number
          id: string
          intervalo_min_comando_s: number
          ir_protocol: string
          laboratorio_id: string
          ligado: boolean
          marca: string
          modelo: string | null
          modo_atual: string
          setpoint_atual: number | null
          setpoint_max: number
          setpoint_min: number
          suporta_aquecimento: boolean
          ultimo_comando_em: string | null
          ultimo_temp_lida: number | null
          updated_at: string
        }
        Insert: {
          agregacao?: string
          ativo?: boolean
          bancada_controladora_id?: string | null
          codigo_ir_raw?: Json | null
          codigo_ir_raw_heat?: Json | null
          created_at?: string
          histerese?: number
          id?: string
          intervalo_min_comando_s?: number
          ir_protocol?: string
          laboratorio_id: string
          ligado?: boolean
          marca?: string
          modelo?: string | null
          modo_atual?: string
          setpoint_atual?: number | null
          setpoint_max?: number
          setpoint_min?: number
          suporta_aquecimento?: boolean
          ultimo_comando_em?: string | null
          ultimo_temp_lida?: number | null
          updated_at?: string
        }
        Update: {
          agregacao?: string
          ativo?: boolean
          bancada_controladora_id?: string | null
          codigo_ir_raw?: Json | null
          codigo_ir_raw_heat?: Json | null
          created_at?: string
          histerese?: number
          id?: string
          intervalo_min_comando_s?: number
          ir_protocol?: string
          laboratorio_id?: string
          ligado?: boolean
          marca?: string
          modelo?: string | null
          modo_atual?: string
          setpoint_atual?: number | null
          setpoint_max?: number
          setpoint_min?: number
          suporta_aquecimento?: boolean
          ultimo_comando_em?: string | null
          ultimo_temp_lida?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ar_condicionados_bancada_controladora_id_fkey"
            columns: ["bancada_controladora_id"]
            isOneToOne: false
            referencedRelation: "bancadas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_condicionados_laboratorio_id_fkey"
            columns: ["laboratorio_id"]
            isOneToOne: false
            referencedRelation: "laboratorios"
            referencedColumns: ["id"]
          },
        ]
      }
      auditoria: {
        Row: {
          criado_em: string
          dados_anteriores: Json | null
          dados_novos: Json | null
          id: string
          operacao: string
          registro_id: string | null
          tabela: string
          usuario_email: string | null
          usuario_id: string | null
        }
        Insert: {
          criado_em?: string
          dados_anteriores?: Json | null
          dados_novos?: Json | null
          id?: string
          operacao: string
          registro_id?: string | null
          tabela: string
          usuario_email?: string | null
          usuario_id?: string | null
        }
        Update: {
          criado_em?: string
          dados_anteriores?: Json | null
          dados_novos?: Json | null
          id?: string
          operacao?: string
          registro_id?: string | null
          tabela?: string
          usuario_email?: string | null
          usuario_id?: string | null
        }
        Relationships: []
      }
      bancada_secrets: {
        Row: {
          bancada_id: string
          created_at: string
          device_token: string
          paired_at: string | null
          pairing_code: string | null
          pairing_expires_at: string | null
        }
        Insert: {
          bancada_id: string
          created_at?: string
          device_token: string
          paired_at?: string | null
          pairing_code?: string | null
          pairing_expires_at?: string | null
        }
        Update: {
          bancada_id?: string
          created_at?: string
          device_token?: string
          paired_at?: string | null
          pairing_code?: string | null
          pairing_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bancada_secrets_bancada_id_fkey"
            columns: ["bancada_id"]
            isOneToOne: true
            referencedRelation: "bancadas"
            referencedColumns: ["id"]
          },
        ]
      }
      bancada_status_log: {
        Row: {
          bancada_id: string
          changed_at: string
          id: number
          status: string
        }
        Insert: {
          bancada_id: string
          changed_at?: string
          id?: number
          status: string
        }
        Update: {
          bancada_id?: string
          changed_at?: string
          id?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "bancada_status_log_bancada_id_fkey"
            columns: ["bancada_id"]
            isOneToOne: false
            referencedRelation: "bancadas"
            referencedColumns: ["id"]
          },
        ]
      }
      bancada_telemetry_debug: {
        Row: {
          bancada_id: string
          firmware_version: string | null
          id: string
          ip_local: string | null
          proximo_ciclo_segundos: number | null
          received_at: string
          sensor_reinicios: number | null
          sensor_travado: boolean | null
          status: string | null
          temperatura_planta: number | null
          temperatura_valida: boolean | null
          valvulas: Json | null
        }
        Insert: {
          bancada_id: string
          firmware_version?: string | null
          id?: string
          ip_local?: string | null
          proximo_ciclo_segundos?: number | null
          received_at?: string
          sensor_reinicios?: number | null
          sensor_travado?: boolean | null
          status?: string | null
          temperatura_planta?: number | null
          temperatura_valida?: boolean | null
          valvulas?: Json | null
        }
        Update: {
          bancada_id?: string
          firmware_version?: string | null
          id?: string
          ip_local?: string | null
          proximo_ciclo_segundos?: number | null
          received_at?: string
          sensor_reinicios?: number | null
          sensor_travado?: boolean | null
          status?: string | null
          temperatura_planta?: number | null
          temperatura_valida?: boolean | null
          valvulas?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "bancada_telemetry_debug_bancada_id_fkey"
            columns: ["bancada_id"]
            isOneToOne: false
            referencedRelation: "bancadas"
            referencedColumns: ["id"]
          },
        ]
      }
      bancadas: {
        Row: {
          config: Json
          config_version: number
          created_at: string
          firmware_version: string | null
          id: string
          ip_local: string | null
          laboratorio_id: string | null
          luz_ligada: boolean
          nome: string
          offline_threshold_segundos: number
          posicao: number | null
          proximo_ciclo_segundos: number
          sensor_reinicios: number | null
          sensor_travado: boolean | null
          status: string
          status_desde: string | null
          tem_rtc: boolean | null
          temp_max: number | null
          temp_min: number | null
          temperatura_planta: number | null
          ultima_sync: string | null
          valvulas: Json
        }
        Insert: {
          config?: Json
          config_version?: number
          created_at?: string
          firmware_version?: string | null
          id?: string
          ip_local?: string | null
          laboratorio_id?: string | null
          luz_ligada?: boolean
          nome: string
          offline_threshold_segundos?: number
          posicao?: number | null
          proximo_ciclo_segundos?: number
          sensor_reinicios?: number | null
          sensor_travado?: boolean | null
          status?: string
          status_desde?: string | null
          tem_rtc?: boolean | null
          temp_max?: number | null
          temp_min?: number | null
          temperatura_planta?: number | null
          ultima_sync?: string | null
          valvulas?: Json
        }
        Update: {
          config?: Json
          config_version?: number
          created_at?: string
          firmware_version?: string | null
          id?: string
          ip_local?: string | null
          laboratorio_id?: string | null
          luz_ligada?: boolean
          nome?: string
          offline_threshold_segundos?: number
          posicao?: number | null
          proximo_ciclo_segundos?: number
          sensor_reinicios?: number | null
          sensor_travado?: boolean | null
          status?: string
          status_desde?: string | null
          tem_rtc?: boolean | null
          temp_max?: number | null
          temp_min?: number | null
          temperatura_planta?: number | null
          ultima_sync?: string | null
          valvulas?: Json
        }
        Relationships: [
          {
            foreignKeyName: "bancadas_laboratorio_id_fkey"
            columns: ["laboratorio_id"]
            isOneToOne: false
            referencedRelation: "laboratorios"
            referencedColumns: ["id"]
          },
        ]
      }
      bench_rate_state: {
        Row: {
          bancada_id: string
          req_count: number
          window_start: string
        }
        Insert: {
          bancada_id: string
          req_count?: number
          window_start?: string
        }
        Update: {
          bancada_id?: string
          req_count?: number
          window_start?: string
        }
        Relationships: []
      }
      comandos: {
        Row: {
          bancada_id: string
          created_at: string
          entregue_em: string | null
          id: string
          payload: Json
          tipo: string
        }
        Insert: {
          bancada_id: string
          created_at?: string
          entregue_em?: string | null
          id?: string
          payload?: Json
          tipo: string
        }
        Update: {
          bancada_id?: string
          created_at?: string
          entregue_em?: string | null
          id?: string
          payload?: Json
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "comandos_bancada_id_fkey"
            columns: ["bancada_id"]
            isOneToOne: false
            referencedRelation: "bancadas"
            referencedColumns: ["id"]
          },
        ]
      }
      laboratorios: {
        Row: {
          cor: string
          created_at: string
          descricao: string | null
          id: string
          nome: string
          ordem: number
        }
        Insert: {
          cor?: string
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          ordem?: number
        }
        Update: {
          cor?: string
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          ordem?: number
        }
        Relationships: []
      }
      medicoes_temperatura: {
        Row: {
          bancada_id: string
          created_at: string
          id: number
          minuto: string
          valor: number
        }
        Insert: {
          bancada_id: string
          created_at?: string
          id?: number
          minuto: string
          valor: number
        }
        Update: {
          bancada_id?: string
          created_at?: string
          id?: number
          minuto?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "medicoes_temperatura_bancada_id_fkey"
            columns: ["bancada_id"]
            isOneToOne: false
            referencedRelation: "bancadas"
            referencedColumns: ["id"]
          },
        ]
      }
      termos_aceites: {
        Row: {
          aceito_em: string
          user_id: string
          versao: string
        }
        Insert: {
          aceito_em?: string
          user_id: string
          versao?: string
        }
        Update: {
          aceito_em?: string
          user_id?: string
          versao?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bench_ir_save_raw: {
        Args: {
          _ar_id: string
          _bancada_id: string
          _device_token: string
          _raw: Json
        }
        Returns: Json
      }
      bench_ir_save_raw_heat: {
        Args: {
          _ar_id: string
          _bancada_id: string
          _device_token: string
          _raw: Json
        }
        Returns: Json
      }
      bench_pair: { Args: { _pairing_code: string }; Returns: Json }
      bench_pull_commands: {
        Args: { _bancada_id: string; _device_token: string }
        Returns: Json
      }
      bench_push_telemetry: {
        Args: {
          _bancada_id: string
          _device_token: string
          _firmware_version: string
          _ip_local: string
          _luz_ligada?: boolean
          _proximo_ciclo_segundos: number
          _sensor_reinicios?: number
          _sensor_travado?: boolean
          _status: string
          _tem_rtc?: boolean
          _temperatura_planta?: number
          _temperatura_valida?: boolean
          _valvulas: Json
        }
        Returns: Json
      }
      check_rate_limit: {
        Args: { _bancada_id: string; _max?: number }
        Returns: boolean
      }
      decidir_ar_condicionado: { Args: never; Returns: number }
      detectar_alertas: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      trigger_scheduled_cycles: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "operador" | "visualizador"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "operador", "visualizador"],
    },
  },
} as const
