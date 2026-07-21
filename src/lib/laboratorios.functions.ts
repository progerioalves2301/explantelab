import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Laboratorio } from "./types";
import { requireTecnico } from "@/lib/role-middleware";

export const listLaboratorios = createServerFn({ method: "GET" }).handler(
  async (): Promise<Laboratorio[]> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await supabaseAdmin
      .from("laboratorios")
      .select("*")
      .order("ordem", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Laboratorio[];
  },
);

export const criarLaboratorio = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator(
    (data: { nome: string; descricao?: string; cor?: string; ordem?: number }) =>
      z
        .object({
          nome: z.string().min(2).max(60),
          descricao: z.string().max(200).optional(),
          cor: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .optional(),
          ordem: z.number().int().min(0).max(999).optional(),
        })
        .parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: row, error } = await supabaseAdmin
      .from("laboratorios")
      .insert({
        nome: data.nome,
        descricao: data.descricao ?? null,
        cor: data.cor ?? "#22c55e",
        ordem: data.ordem ?? 0,
      })
      .select("*")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Falha ao criar");
    return row as unknown as Laboratorio;
  });

export const atualizarLaboratorio = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator(
    (data: {
      id: string;
      nome?: string;
      descricao?: string | null;
      cor?: string;
      ordem?: number;
    }) =>
      z
        .object({
          id: z.string().uuid(),
          nome: z.string().min(2).max(60).optional(),
          descricao: z.string().max(200).nullable().optional(),
          cor: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .optional(),
          ordem: z.number().int().min(0).max(999).optional(),
        })
        .parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { id, ...rest } = data;
    const { error } = await supabaseAdmin
      .from("laboratorios")
      .update(rest)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const excluirLaboratorio = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator((data: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    // bancadas.laboratorio_id vira NULL automaticamente (ON DELETE SET NULL).
    const { error } = await supabaseAdmin
      .from("laboratorios")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const atribuirBancadaLaboratorio = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator(
    (data: {
      bancada_id: string;
      laboratorio_id: string | null;
      posicao: number | null;
    }) =>
      z
        .object({
          bancada_id: z.string().uuid(),
          laboratorio_id: z.string().uuid().nullable(),
          posicao: z.number().int().min(1).max(999).nullable(),
        })
        .parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin
      .from("bancadas")
      .update({
        laboratorio_id: data.laboratorio_id,
        posicao: data.posicao,
      })
      .eq("id", data.bancada_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
