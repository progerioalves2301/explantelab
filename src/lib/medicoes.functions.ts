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
  "60d": 24 * 60,
  "120d": 24 * 120,
} as const;

export type PeriodoGrafico = keyof typeof PERIODOS;

// Tamanho do bucket (em minutos) por período — mantém no máx ~2000 pontos
const BUCKET_MIN: Record<PeriodoGrafico, number> = {
  "6h": 1,
  "24h": 1,
  "7d": 10,
  "30d": 30,
  "60d": 60,
  "120d": 120,
};

export const listarHistoricoTemperatura = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { bancada_id: string; periodo: PeriodoGrafico }) => input,
  )
  .handler(async ({ data, context }) => {
    const horas = PERIODOS[data.periodo] ?? 24;
    let desde = new Date(Date.now() - horas * 3600 * 1000).toISOString();
    const bucketMin = BUCKET_MIN[data.periodo] ?? 1;

    // Se um novo ciclo foi iniciado nesta prateleira e ele começou dentro
    // da janela, cortamos o histórico no marco — cada ciclo mostra só seus
    // próprios dados.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: banc } = await (context.supabase as any)
      .from("bancadas")
      .select("ciclo_iniciado_em")
      .eq("id", data.bancada_id)
      .maybeSingle();
    const cicloIni = banc?.ciclo_iniciado_em as string | null | undefined;
    if (cicloIni && cicloIni > desde) desde = cicloIni;

    // Paginação para vencer o teto de 1000 linhas do PostgREST em janelas longas
    const pageSize = 1000;
    const all: { minuto: string; valor: number }[] = [];
    let offset = 0;
    // hard cap defensivo (60 páginas = 60k linhas)
    for (let i = 0; i < 60; i++) {
      const { data: rows, error } = await context.supabase
        .from("medicoes_temperatura")
        .select("minuto, valor")
        .eq("bancada_id", data.bancada_id)
        .gte("minuto", desde)
        .order("minuto", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(error.message);
      const batch = rows ?? [];
      for (const r of batch) {
        all.push({ minuto: r.minuto as string, valor: Number(r.valor) });
      }
      if (batch.length < pageSize) break;
      offset += pageSize;
    }

    if (bucketMin <= 1) return all satisfies PontoTemperatura[];

    // Agrega por bucket usando MÁX (preserva picos, coerente com relatórios)
    const bucketMs = bucketMin * 60_000;
    const buckets = new Map<number, { max: number }>();
    for (const p of all) {
      const t = new Date(p.minuto).getTime();
      const key = Math.floor(t / bucketMs) * bucketMs;
      const cur = buckets.get(key);
      if (!cur || p.valor > cur.max) buckets.set(key, { max: p.valor });
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([k, v]) => ({
        minuto: new Date(k).toISOString(),
        valor: v.max,
      })) satisfies PontoTemperatura[];
  });
