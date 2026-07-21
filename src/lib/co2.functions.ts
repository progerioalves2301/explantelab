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

export type PontoCo2 = { medido_em: string; ppm: number };

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

const PERIODOS = { "6h": 6, "24h": 24, "7d": 24 * 7, "30d": 24 * 30 } as const;
export type PeriodoCo2 = keyof typeof PERIODOS;

export const listarHistoricoCo2 = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { laboratorio_id: string; periodo: PeriodoCo2 }) => input,
  )
  .handler(async ({ data, context }) => {
    const horas = PERIODOS[data.periodo] ?? 24;
    const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString();
    const { data: rows, error } = await context.supabase
      .from("medicoes_co2")
      .select("medido_em, ppm")
      .eq("laboratorio_id", data.laboratorio_id)
      .gte("medido_em", desde)
      .order("medido_em", { ascending: true })
      .limit(5000);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      medido_em: r.medido_em as string,
      ppm: Number(r.ppm),
    })) as PontoCo2[];
  });
