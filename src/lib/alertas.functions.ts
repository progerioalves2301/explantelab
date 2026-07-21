import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOperador } from "@/lib/role-middleware";

export type AlertaTipo = "offline" | "temperatura" | "ciclo";
export type AlertaSeveridade = "warning" | "critical";

export interface Alerta {
  id: string;
  bancada_id: string;
  tipo: AlertaTipo;
  severidade: AlertaSeveridade;
  mensagem: string;
  valor: Record<string, string | number | boolean | null>;

  notificado_em: string | null;
  resolvido_em: string | null;
  created_at: string;
  bancada_nome?: string;
}

export interface AlertaDestino {
  id: string;
  chat_id: string;
  nome: string;
  ativo: boolean;
  created_at: string;
}

export const listarAlertas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Alerta[]> => {
    const { data, error } = await context.supabase
      .from("alertas")
      .select("*, bancadas(nome)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []).map((a: any) => ({
      ...a,
      bancada_nome: a.bancadas?.nome ?? null,
    })) as Alerta[];
  });

export const listarAlertasPeriodo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { desde: string; ate: string }) =>
    z.object({ desde: z.string(), ate: z.string() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<Alerta[]> => {
    const { data: rows, error } = await context.supabase
      .from("alertas")
      .select("*, bancadas(nome, laboratorio_id)")
      .gte("created_at", data.desde)
      .lte("created_at", data.ate)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((a: any) => ({
      ...a,
      bancada_nome: a.bancadas?.nome ?? null,
      laboratorio_id: a.bancadas?.laboratorio_id ?? null,
    })) as unknown as Alerta[];
  });

export const resolverAlerta = createServerFn({ method: "POST" })
  .middleware([requireOperador])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("alertas")
      .update({ resolvido_em: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listarDestinos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AlertaDestino[]> => {
    const { data, error } = await context.supabase
      .from("alerta_destinos")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as AlertaDestino[];
  });

export const criarDestino = createServerFn({ method: "POST" })
  .middleware([requireOperador])
  .inputValidator((d: { chat_id: string; nome: string }) =>
    z.object({ chat_id: z.string().min(1).max(40), nome: z.string().min(1).max(80) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("alerta_destinos")
      .insert({ chat_id: data.chat_id, nome: data.nome });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleDestino = createServerFn({ method: "POST" })
  .middleware([requireOperador])
  .inputValidator((d: { id: string; ativo: boolean }) =>
    z.object({ id: z.string().uuid(), ativo: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("alerta_destinos")
      .update({ ativo: data.ativo })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removerDestino = createServerFn({ method: "POST" })
  .middleware([requireOperador])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("alerta_destinos")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const salvarAlertaConfig = createServerFn({ method: "POST" })
  .middleware([requireOperador])
  .inputValidator(
    (d: {
      bancada_id: string;
      temp_min: number | null;
      temp_max: number | null;
      offline_threshold_segundos: number;
    }) =>
      z
        .object({
          bancada_id: z.string().uuid(),
          temp_min: z.number().nullable(),
          temp_max: z.number().nullable(),
          offline_threshold_segundos: z.number().int().min(30).max(86400),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("bancadas")
      .update({
        temp_min: data.temp_min,
        temp_max: data.temp_max,
        offline_threshold_segundos: data.offline_threshold_segundos,
      })
      .eq("id", data.bancada_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Testa envio de mensagem ao Telegram para um destino específico. Admin. */
export const testarDestino = createServerFn({ method: "POST" })
  .middleware([requireOperador])
  .inputValidator((d: { chat_id: string }) => z.object({ chat_id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const tgKey = process.env.TELEGRAM_API_KEY;
    if (!lovableKey || !tgKey) throw new Error("Telegram não configurado");
    const res = await fetch("https://connector-gateway.lovable.dev/telegram/sendMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": tgKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: data.chat_id,
        text: "✅ <b>Explante Lab</b>\nTeste de notificação — destino configurado com sucesso.",
        parse_mode: "HTML",
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Telegram ${res.status}: ${JSON.stringify(body)}`);
    return { ok: true };
  });
