import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTecnico } from "@/lib/role-middleware";

export type Muda = {
  id: string;
  identificador: string;
  especie: string | null;
  laboratorio_id: string | null;
  bancada_id: string | null;
  data_inicio: string;
  data_fim: string | null;
  ativa: boolean;
  observacoes: string | null;
  peso_inicial_g: number | null;
  created_at: string;
};

export type MedicaoPeso = {
  id: string;
  muda_id: string;
  valor_g: number;
  medido_em: string;
  origem: string;
  observacoes: string | null;
};

export type MudaPeriodo = {
  id: string;
  identificador: string;
  especie: string | null;
  bancada_id: string | null;
  laboratorio_id: string | null;
  data_inicio: string;
  data_fim: string | null;
  ativa: boolean;
};

export const listarMudasPeriodo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { desde: string; ate: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("mudas")
      .select(
        "id, identificador, especie, bancada_id, laboratorio_id, data_inicio, data_fim, ativa",
      )
      .lte("data_inicio", data.ate)
      .or(`data_fim.is.null,data_fim.gte.${data.desde}`)
      .order("data_inicio", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as MudaPeriodo[];
  });


export const listarMudas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { apenas_ativas?: boolean } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("mudas")
      .select("*")
      .order("created_at", { ascending: false });
    if (data.apenas_ativas) q = q.eq("ativa", true);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as Muda[];
  });

const criarSchema = z.object({
  identificador: z.string().min(1).max(64),
  especie: z.string().max(120).optional().nullable(),
  laboratorio_id: z.string().uuid().optional().nullable(),
  bancada_id: z.string().uuid().optional().nullable(),
  peso_inicial_g: z.number().min(0).max(100000).optional().nullable(),
  observacoes: z.string().max(2000).optional().nullable(),
});

export const criarMuda = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator((input: z.infer<typeof criarSchema>) => criarSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("mudas")
      .insert({
        identificador: data.identificador,
        especie: data.especie ?? null,
        laboratorio_id: data.laboratorio_id ?? null,
        bancada_id: data.bancada_id ?? null,
        peso_inicial_g: data.peso_inicial_g ?? null,
        observacoes: data.observacoes ?? null,
        criado_por: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    // Se veio peso inicial, já registra a primeira medição
    if (data.peso_inicial_g != null && row) {
      await context.supabase.from("medicoes_peso").insert({
        muda_id: row.id,
        laboratorio_id: data.laboratorio_id ?? null,
        valor_g: data.peso_inicial_g,
        origem: "manual",
        operador_id: context.userId,
        observacoes: "Peso inicial",
      });
    }
    return row as unknown as Muda;
  });

const editarSchema = z.object({
  id: z.string().uuid(),
  identificador: z.string().min(1).max(64),
  especie: z.string().max(120).optional().nullable(),
  laboratorio_id: z.string().uuid().optional().nullable(),
  bancada_id: z.string().uuid().optional().nullable(),
  observacoes: z.string().max(2000).optional().nullable(),
});

export const editarMuda = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator((input: z.infer<typeof editarSchema>) => editarSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("mudas")
      .update({
        identificador: data.identificador,
        especie: data.especie ?? null,
        laboratorio_id: data.laboratorio_id ?? null,
        bancada_id: data.bancada_id ?? null,
        observacoes: data.observacoes ?? null,
      })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as unknown as Muda;
  });

export const encerrarMuda = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("mudas")
      .update({ ativa: false, data_fim: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const excluirMuda = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("mudas").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const pesagemSchema = z.object({
  muda_id: z.string().uuid(),
  valor_g: z.number().min(0).max(100000),
  observacoes: z.string().max(2000).optional().nullable(),
});

export const registrarPesagem = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator((input: z.infer<typeof pesagemSchema>) => pesagemSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: muda } = await context.supabase
      .from("mudas")
      .select("laboratorio_id")
      .eq("id", data.muda_id)
      .single();

    const { data: row, error } = await context.supabase
      .from("medicoes_peso")
      .insert({
        muda_id: data.muda_id,
        laboratorio_id: muda?.laboratorio_id ?? null,
        valor_g: data.valor_g,
        origem: "manual",
        operador_id: context.userId,
        observacoes: data.observacoes ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as unknown as MedicaoPeso;
  });

export const listarPesagens = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { muda_id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("medicoes_peso")
      .select("*")
      .eq("muda_id", data.muda_id)
      .order("medido_em", { ascending: true })
      .limit(5000);
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as MedicaoPeso[];
  });

export const excluirPesagem = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("medicoes_peso")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
