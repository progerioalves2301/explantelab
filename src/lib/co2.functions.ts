import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTecnico } from "@/lib/role-middleware";

export type SensorCo2 = {
  id: string;
  laboratorio_id: string;
  nome: string;
  device_token: string;
  ultima_leitura_ppm: number | null;
  ultima_medicao_em: string | null;
  ativo: boolean;
  created_at: string;
};

export type PontoCo2 = { 
  medido_em: string; 
  ppm: number;
  umidade_pct?: number | null;
};

export const listarSensoresCo2 = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("sensores_co2")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SensorCo2[];
  });

function novoToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const criarSensorCo2 = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator((input: { laboratorio_id: string; nome: string }) =>
    z
      .object({
        laboratorio_id: z.string().uuid(),
        nome: z.string().min(1).max(120),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("sensores_co2")
      .insert({
        laboratorio_id: data.laboratorio_id,
        nome: data.nome,
        device_token: novoToken(),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as unknown as SensorCo2;
  });

export const removerSensorCo2 = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator((input: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("sensores_co2")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const alternarSensorCo2 = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator((input: { id: string; ativo: boolean }) =>
    z.object({ id: z.string().uuid(), ativo: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("sensores_co2")
      .update({ ativo: data.ativo })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const PERIODOS = {
  "6h": 6,
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
  "60d": 24 * 60,
  "120d": 24 * 120,
} as const;
export type PeriodoCo2 = keyof typeof PERIODOS;

export const listarHistoricoCo2 = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { laboratorio_id: string; periodo: PeriodoCo2 }) => input,
  )
  .handler(async ({ data, context }) => {
    const horas = PERIODOS[data.periodo] ?? 24;
    const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString();

    // A API limita cada resposta a 1000 linhas; paginamos para não perder as
    // leituras mais recentes (24 h = ~1440 pontos).
    const pageSize = 1000;
    const rows: { medido_em: string; ppm: number | null; umidade_pct: number | null }[] = [];
    for (let offset = 0; offset < 60_000; offset += pageSize) {
      const { data: page, error } = await context.supabase
        .from("medicoes_co2")
        .select("medido_em, ppm, umidade_pct")
        .eq("laboratorio_id", data.laboratorio_id)
        .gte("medido_em", desde)
        .order("medido_em", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(error.message);
      const lote = page ?? [];
      rows.push(...(lote as any[]));
      if (lote.length < pageSize) break;
    }

    return rows.map((r) => ({
      medido_em: r.medido_em as string,
      ppm: Number(r.ppm),
      umidade_pct: r.umidade_pct != null ? Number(r.umidade_pct) : null,
    })) as PontoCo2[];
  });

/**
 * Gera uma senha de pareamento de 6 dígitos (válida 24 h) para o módulo de CO2.
 * O firmware troca essa senha pelo device_token em POST /api/public/co2/pair.
 */
export const gerarCodigoPareamentoCo2 = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator((input: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const expires_at = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    let pairing_code = "";
    let lastErr: string | null = null;
    for (let i = 0; i < 6; i++) {
      const n = new Uint32Array(1);
      crypto.getRandomValues(n);
      pairing_code = String(n[0]! % 1_000_000).padStart(6, "0");
      const { error } = await context.supabase
        .from("sensores_co2")
        .update({ pairing_code, pairing_expires_at: expires_at })
        .eq("id", data.id);
      if (!error) {
        lastErr = null;
        break;
      }
      lastErr = error.message;
      if (!/pairing_code/i.test(error.message)) break;
    }
    if (lastErr) throw new Error(lastErr);
    return { pairing_code, expires_at };
  });
