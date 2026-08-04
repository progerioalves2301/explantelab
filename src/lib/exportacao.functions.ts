import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/lib/role-middleware";

export const TABELAS_EXPORTAVEIS = [
  "bancadas",
  "laboratorios",
  "mudas",
  "medicoes_temperatura",
  "medicoes_peso",
  "medicoes_co2",
  "alertas",
  "comandos",
  "auditoria",
] as const;

export type TabelaExportavel = (typeof TABELAS_EXPORTAVEIS)[number];

/** Coluna de data usada para filtrar por período (null = tabela sem histórico). */
export const COLUNA_DATA: Record<TabelaExportavel, string | null> = {
  bancadas: null,
  laboratorios: null,
  mudas: "created_at",
  medicoes_temperatura: "minuto",
  medicoes_peso: "medido_em",
  medicoes_co2: "medido_em",
  alertas: "created_at",
  comandos: "created_at",
  auditoria: "criado_em",
};

/** Tabelas com dados pessoais — exportação fica registrada na auditoria (LGPD). */
export const TABELAS_SENSIVEIS: readonly TabelaExportavel[] = ["auditoria"];

export const LIMITE_LINHAS = 50000;

const inputSchema = z.object({
  tabela: z.enum(TABELAS_EXPORTAVEIS),
  dias: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(0)]),
});

export type CelulaCsv = string | number | boolean | null;

export interface ResultadoExportacao {
  tabela: string;
  colunas: string[];
  linhas: CelulaCsv[][];
  truncado: boolean;
}

export const exportarTabela = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((data: { tabela: TabelaExportavel; dias: 7 | 30 | 90 | 0 }) =>
    inputSchema.parse(data),
  )
  .handler(async ({ data, context }): Promise<ResultadoExportacao> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const coluna = COLUNA_DATA[data.tabela];
    let query = supabaseAdmin
      .from(data.tabela)
      .select("*")
      .limit(LIMITE_LINHAS + 1);

    if (coluna && data.dias > 0) {
      const desde = new Date(
        Date.now() - data.dias * 24 * 60 * 60 * 1000,
      ).toISOString();
      query = query.gte(coluna, desde).order(coluna, { ascending: false });
    } else if (coluna) {
      query = query.order(coluna, { ascending: false });
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const todas = (rows ?? []) as Record<string, unknown>[];
    const truncado = todas.length > LIMITE_LINHAS;
    const registros = truncado ? todas.slice(0, LIMITE_LINHAS) : todas;
    const colunas = registros.length > 0 ? Object.keys(registros[0]!) : [];
    const linhas: CelulaCsv[][] = registros.map((r) =>
      colunas.map((c) => {
        const v = r[c];
        if (v === null || v === undefined) return null;
        if (typeof v === "object") return JSON.stringify(v);
        if (typeof v === "number" || typeof v === "boolean") return v;
        return String(v);
      }),
    );

    if (TABELAS_SENSIVEIS.includes(data.tabela)) {
      await supabaseAdmin.from("auditoria").insert({
        usuario_id: context.userId,
        tabela: data.tabela,
        operacao: "EXPORT",
        registro_id: null,
        dados_novos: {
          linhas: linhas.length,
          dias: data.dias,
        } as never,
      });
    }

    return { tabela: data.tabela, colunas, linhas, truncado };
  });
