import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOperador, requireTecnico } from "@/lib/role-middleware";

export type Balanca = {
  id: string;
  nome: string;
  bancada_associada_id: string | null;
  paired_at: string | null;
  ativa: boolean;
  fator_calibracao: number;
  tara_g: number;
  ultima_leitura_g: number | null;
  ultima_sync: string | null;
  ultimo_ciclo_fim: string | null;
  minutos_estabilizacao: number;
  outlier_delta_g: number;
  residuo_ultimo_ciclo_g: number | null;
  created_at: string;
};

export const listarBalancas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("balancas")
      .select("id, nome, bancada_associada_id, ativa, fator_calibracao, tara_g, ultima_leitura_g, ultima_sync, ultimo_ciclo_fim, minutos_estabilizacao, outlier_delta_g, residuo_ultimo_ciclo_g, paired_at, created_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as Balanca[];
  });

const criarBalancaSchema = z.object({
  nome: z.string().min(2).max(60),
  bancada_associada_id: z.string().uuid().nullable().optional(),
  minutos_estabilizacao: z.number().int().min(0).max(60).optional(),
  outlier_delta_g: z.number().min(0.1).max(1000).optional(),
});

export const criarBalanca = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator((data: z.infer<typeof criarBalancaSchema>) => criarBalancaSchema.parse(data))
  .handler(async ({ data, context }) => {
    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    const deviceToken = btoa(String.fromCharCode(...raw))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const { data: row, error } = await context.supabase
      .from("balancas")
      .insert({
        nome: data.nome,
        bancada_associada_id: data.bancada_associada_id || null,
        device_token: deviceToken,
        minutos_estabilizacao: data.minutos_estabilizacao ?? 5,
        outlier_delta_g: data.outlier_delta_g ?? 10.0,
      } as any)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { balanca: row as unknown as Balanca };
  });


export const editarBalanca = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator(z.object({
    id: z.string().uuid(),
    nome: z.string().min(2).max(60).optional(),
    bancada_associada_id: z.string().uuid().nullable().optional(),
    ativa: z.boolean().optional(),
    minutos_estabilizacao: z.number().int().min(0).max(60).optional(),
    outlier_delta_g: z.number().min(0.1).max(1000).optional(),
  }))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { data: row, error } = await context.supabase
      .from("balancas")
      .update(patch as any)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as Balanca;
  });

export const excluirBalanca = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("balancas")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const enviarComandoBalanca = createServerFn({ method: "POST" })
  .middleware([requireOperador])
  .inputValidator(z.object({
    balanca_id: z.string().uuid(),
    tipo: z.enum(["BALANCA_TARA", "BALANCA_CALIBRAR", "BALANCA_RESET"]),
    payload: z.record(z.string(), z.unknown()).optional(),
  }))
  .handler(async ({ data, context }) => {
    // 1. Busca o device_token da balança e a prateleira associada
    const { data: balanca, error: bErr } = await context.supabase
      .from("balancas")
      .select("device_token, bancada_associada_id")
      .eq("id", data.balanca_id)
      .single();
    if (bErr || !balanca) throw new Error("Balança não encontrada");

    // 2. Se tiver prateleira, manda comando para o ID da prateleira também
    // O comando é genérico, o ESP da balança escuta pelo device_token ou ID associado.
    const { error: cErr } = await context.supabase
      .from("comandos")
      .insert({
        bancada_id: balanca.bancada_associada_id as any,
        tipo: data.tipo,
        payload: {
          ...data.payload,
          device_token: balanca.device_token,
          balanca_id: data.balanca_id,
        } as any,
      });

    if (cErr) throw new Error(cErr.message);
    return { ok: true };
  });
