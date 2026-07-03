import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Bancada, ComandoTipo, Configuracoes } from "./types";

const configSchema = z.object({
  tempo_injecao_segundos: z.number().int().min(1).max(3600),
  tempo_pausa_segundos: z.number().int().min(0).max(3600),
  tempo_retorno_segundos: z.number().int().min(1).max(3600),
  tempo_alivio_segundos: z.number().int().min(0).max(600),
  intervalo_ciclo_horas: z.number().int().min(1).max(72),
});

// Lista todas as bancadas (público — dashboard usa realtime a partir daqui).
export const listBancadas = createServerFn({ method: "GET" }).handler(
  async (): Promise<Bancada[]> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await supabaseAdmin
      .from("bancadas")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Bancada[];
  },
);

// Cria bancada + device_token. Retorna o token UMA VEZ.
export const criarBancada = createServerFn({ method: "POST" })
  .inputValidator((data: { nome: string }) =>
    z.object({ nome: z.string().min(2).max(60) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: bancada, error } = await supabaseAdmin
      .from("bancadas")
      .insert({ nome: data.nome, status: "Offline" })
      .select("*")
      .single();
    if (error || !bancada) throw new Error(error?.message ?? "Falha ao criar");

    // Gera token 32 bytes → base64url
    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    const device_token = btoa(String.fromCharCode(...raw))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const { error: secErr } = await supabaseAdmin
      .from("bancada_secrets")
      .insert({ bancada_id: bancada.id, device_token });
    if (secErr) throw new Error(secErr.message);

    return {
      bancada: bancada as unknown as Bancada,
      device_token,
      server_url:
        process.env.PUBLIC_SITE_URL ??
        "https://project--90989b19-e7c7-43b6-a4a1-5affc6bb05c8.lovable.app",
    };
  });

// Excluir bancada
export const excluirBancada = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin
      .from("bancadas")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Enviar comando (força ciclo, pausa, retoma).
export const enviarComando = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      bancada_id: string;
      tipo: ComandoTipo;
      payload?: Record<string, unknown>;
    }) =>
      z
        .object({
          bancada_id: z.string().uuid(),
          tipo: z.enum(["FORCE_CYCLE", "UPDATE_CONFIG", "PAUSE", "RESUME"]),
          payload: z.record(z.string(), z.unknown()).optional(),
        })
        .parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin
      .from("comandos")
      .insert({
        bancada_id: data.bancada_id,
        tipo: data.tipo,
        payload: (data.payload ?? {}) as never,
      });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Salvar config da bancada + disparar UPDATE_CONFIG.
export const salvarConfig = createServerFn({ method: "POST" })
  .inputValidator((data: { bancada_id: string; config: Configuracoes }) =>
    z
      .object({
        bancada_id: z.string().uuid(),
        config: configSchema,
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: updated, error } = await supabaseAdmin
      .from("bancadas")
      .update({
        config: data.config,
        config_version: undefined as unknown as number, // será incrementado abaixo
      })
      .eq("id", data.bancada_id)
      .select("config_version")
      .single();
    if (error || !updated) throw new Error(error?.message ?? "Falha");

    // Incrementa versão em um segundo update (mais simples que RPC).
    const { error: bumpErr } = await supabaseAdmin
      .from("bancadas")
      .update({ config_version: (updated.config_version ?? 0) + 1 })
      .eq("id", data.bancada_id);
    if (bumpErr) throw new Error(bumpErr.message);

    // Comando para o ESP32 puxar a nova config.
    await supabaseAdmin.from("comandos").insert({
      bancada_id: data.bancada_id,
      tipo: "UPDATE_CONFIG",
      payload: data.config as never,
    });
    return { ok: true };
  });
