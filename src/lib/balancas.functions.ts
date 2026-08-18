import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTecnico } from "@/lib/role-middleware";

export type Balanca = {
  id: string;
  nome: string;
  bancada_associada_id: string | null;
  device_token: string;
  ativa: boolean;
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
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as Balanca[];
  });

const criarBalancaSchema = z.object({
  nome: z.string().min(2).max(60),
  bancada_associada_id: z.string().uuid().nullable().optional(),
  device_token: z.string().min(10),
  minutos_estabilizacao: z.number().int().min(0).max(60).optional(),
  outlier_delta_g: z.number().min(0.1).max(1000).optional(),
});

export const criarBalanca = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator((data: z.infer<typeof criarBalancaSchema>) => criarBalancaSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("balancas")
      .insert({
        nome: data.nome,
        bancada_associada_id: data.bancada_associada_id || null,
        device_token: data.device_token,
        minutos_estabilizacao: data.minutos_estabilizacao ?? 5,
        outlier_delta_g: data.outlier_delta_g ?? 10.0,
      } as any)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as Balanca;
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
