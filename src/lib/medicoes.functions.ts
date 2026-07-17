import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PontoTemperatura = {
  minuto: string; // ISO timestamp
  valor: number;
};

const PERIODOS = {
  "6h": 6,
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
} as const;

export type PeriodoGrafico = keyof typeof PERIODOS;

export const listarHistoricoTemperatura = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { bancada_id: string; periodo: PeriodoGrafico }) => input,
  )
  .handler(async ({ data, context }) => {
    const horas = PERIODOS[data.periodo] ?? 24;
    const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString();

    const { data: rows, error } = await context.supabase
      .from("medicoes_temperatura")
      .select("minuto, valor")
      .eq("bancada_id", data.bancada_id)
      .gte("minuto", desde)
      .order("minuto", { ascending: true })
      .limit(5000);

    if (error) throw new Error(error.message);

    return (rows ?? []).map((r) => ({
      minuto: r.minuto as string,
      valor: Number(r.valor),
    })) satisfies PontoTemperatura[];
  });
