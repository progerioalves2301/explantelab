import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Bancada, ComandoTipo, Configuracoes } from "./types";

const HORARIO_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const configSchema = z.object({
  tempo_injecao_segundos: z.number().int().min(1).max(3600),
  tempo_pausa_segundos: z.number().int().min(0).max(3600),
  tempo_retorno_segundos: z.number().int().min(1).max(3600),
  tempo_alivio_segundos: z.number().int().min(0).max(600),
  horarios_disparo: z
    .array(z.string().regex(HORARIO_REGEX, "Formato HH:MM"))
    .min(1, "Ao menos 1 horário")
    .max(24, "Máximo 24 horários"),
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

// Cria bancada + device_token + código de pareamento de 6 dígitos.
// O usuário digita esses 6 dígitos no portal AP do ESP32; o dispositivo
// então troca o código pelas credenciais reais via /api/public/bench/pair.
export const criarBancada = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      nome: string;
      laboratorio_id?: string | null;
      posicao?: number | null;
    }) =>
      z
        .object({
          nome: z.string().min(2).max(60),
          laboratorio_id: z.string().uuid().nullable().optional(),
          posicao: z.number().int().min(1).max(999).nullable().optional(),
        })
        .parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: bancada, error } = await supabaseAdmin
      .from("bancadas")
      .insert({
        nome: data.nome,
        status: "Offline",
        laboratorio_id: data.laboratorio_id ?? null,
        posicao: data.posicao ?? null,
      })
      .select("*")
      .single();
    if (error || !bancada) throw new Error(error?.message ?? "Falha ao criar");

    // Token 32 bytes → base64url (guardado no ESP32 após o pareamento).
    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    const device_token = btoa(String.fromCharCode(...raw))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    // Código de pareamento único de 6 dígitos, expira em 24h.
    // Retry algumas vezes em caso de colisão (índice único parcial).
    let pairing_code = "";
    let lastErr: string | null = null;
    for (let i = 0; i < 6; i++) {
      const n = new Uint32Array(1);
      crypto.getRandomValues(n);
      pairing_code = String(n[0] % 1_000_000).padStart(6, "0");
      const { error: secErr } = await supabaseAdmin
        .from("bancada_secrets")
        .insert({
          bancada_id: bancada.id,
          device_token,
          pairing_code,
          pairing_expires_at: new Date(
            Date.now() + 24 * 60 * 60 * 1000,
          ).toISOString(),
        });
      if (!secErr) {
        lastErr = null;
        break;
      }
      lastErr = secErr.message;
      // Se não for colisão de código, aborta.
      if (!/pairing_code/i.test(secErr.message)) break;
    }
    if (lastErr) throw new Error(lastErr);

    return {
      bancada: bancada as unknown as Bancada,
      pairing_code,
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
    await supabaseAdmin.from("comandos").delete().eq("bancada_id", data.id);
    await supabaseAdmin
      .from("bancada_secrets")
      .delete()
      .eq("bancada_id", data.id);
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
          tipo: z.enum(["FORCE_CYCLE", "UPDATE_CONFIG", "PAUSE", "RESUME", "SET_VALVE"]),
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
    const { data: current } = await supabaseAdmin
      .from("bancadas")
      .select("config_version")
      .eq("id", data.bancada_id)
      .single();
    const nextVersion = (current?.config_version ?? 0) + 1;

    const { error } = await supabaseAdmin
      .from("bancadas")
      .update({
        config: data.config as never,
        config_version: nextVersion,
      })
      .eq("id", data.bancada_id);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("comandos").insert({
      bancada_id: data.bancada_id,
      tipo: "UPDATE_CONFIG",
      payload: data.config as never,
    });
    return { ok: true };
  });
