import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Bancada, ComandoTipo, Configuracoes } from "./types";
import { withComputedBancadasStatus } from "./bancada-status";
import { requireOperador } from "@/lib/role-middleware";

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
  luz_janelas: z
    .array(
      z.object({
        ligar: z.string().regex(HORARIO_REGEX, "Formato HH:MM"),
        desligar: z.string().regex(HORARIO_REGEX, "Formato HH:MM"),
      }),
    )
    .min(1, "Ao menos 1 janela de luz")
    .max(8, "Máximo 8 janelas"),
  tz: z.string().min(2).max(40).optional(),
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
    return withComputedBancadasStatus((data ?? []) as unknown as Bancada[]);
  },
);

// Cria bancada + device_token + código de pareamento de 6 dígitos.
// O usuário digita esses 6 dígitos no portal AP do ESP32; o dispositivo
// então troca o código pelas credenciais reais via /api/public/bench/pair.
export const criarBancada = createServerFn({ method: "POST" })
  .middleware([requireOperador])
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

    // Se existir ciclo padrão salvo em app_settings, usa como config inicial.
    const { data: preset } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "default_ciclo")
      .maybeSingle();
    const initialConfig = preset?.value ?? null;

    const insertRow: Record<string, unknown> = {
      nome: data.nome,
      status: "Offline",
      laboratorio_id: data.laboratorio_id ?? null,
      posicao: data.posicao ?? null,
    };
    if (initialConfig) insertRow.config = initialConfig;

    const { data: bancada, error } = await supabaseAdmin
      .from("bancadas")
      .insert(insertRow as never)
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
  .middleware([requireOperador])
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

// Regenera o código de pareamento (6 dígitos, válido 24h) para uma bancada
// existente — útil quando o ESP32 é resetado / trocado e precisa re-parear.
// O device_token é preservado (mesmo dispositivo continua válido); apenas o
// código curto para digitação no portal AP é renovado.
export const regenerarPairingCode = createServerFn({ method: "POST" })
  .middleware([requireOperador])
  .inputValidator((data: { bancada_id: string }) =>
    z.object({ bancada_id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    // Garante que existe uma linha em bancada_secrets. Se não existir
    // (bancada antiga sem secret), cria com token novo.
    const { data: existing } = await supabaseAdmin
      .from("bancada_secrets")
      .select("bancada_id, device_token")
      .eq("bancada_id", data.bancada_id)
      .maybeSingle();

    let device_token = existing?.device_token ?? "";
    if (!device_token) {
      const raw = new Uint8Array(32);
      crypto.getRandomValues(raw);
      device_token = btoa(String.fromCharCode(...raw))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    }

    let pairing_code = "";
    let lastErr: string | null = null;
    for (let i = 0; i < 6; i++) {
      const n = new Uint32Array(1);
      crypto.getRandomValues(n);
      pairing_code = String(n[0] % 1_000_000).padStart(6, "0");
      const expires_at = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString();

      const { error: upErr } = existing
        ? await supabaseAdmin
            .from("bancada_secrets")
            .update({
              pairing_code,
              pairing_expires_at: expires_at,
            })
            .eq("bancada_id", data.bancada_id)
        : await supabaseAdmin.from("bancada_secrets").insert({
            bancada_id: data.bancada_id,
            device_token,
            pairing_code,
            pairing_expires_at: expires_at,
          });

      if (!upErr) {
        lastErr = null;
        break;
      }
      lastErr = upErr.message;
      if (!/pairing_code/i.test(upErr.message)) break;
    }
    if (lastErr) throw new Error(lastErr);

    return {
      pairing_code,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  });

// Atualizar propriedades básicas da bancada (nome, laboratório, posição).
export const atualizarBancada = createServerFn({ method: "POST" })
  .middleware([requireOperador])
  .inputValidator(
    (data: {
      id: string;
      nome?: string;
      laboratorio_id?: string | null;
      posicao?: number | null;
    }) =>
      z
        .object({
          id: z.string().uuid(),
          nome: z.string().min(2).max(60).optional(),
          laboratorio_id: z.string().uuid().nullable().optional(),
          posicao: z.number().int().min(1).max(999).nullable().optional(),
        })
        .parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { id, ...rest } = data;
    const patch: Record<string, unknown> = {};
    if (rest.nome !== undefined) patch.nome = rest.nome;
    if (rest.laboratorio_id !== undefined)
      patch.laboratorio_id = rest.laboratorio_id;
    if (rest.posicao !== undefined) patch.posicao = rest.posicao;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin
      .from("bancadas")
      .update(patch as never)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


// Enviar comando (força ciclo, pausa, retoma).
export const enviarComando = createServerFn({ method: "POST" })
  .middleware([requireOperador])
  .inputValidator(
    (data: {
      bancada_id: string;
      tipo: ComandoTipo;
      payload?: Record<string, unknown>;
    }) =>
      z
        .object({
          bancada_id: z.string().uuid(),
          tipo: z.enum(["FORCE_CYCLE", "UPDATE_CONFIG", "PAUSE", "RESUME", "SET_VALVE", "OTA_UPDATE", "AC_CONTROL"]),
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
  .middleware([requireOperador])
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

// Salvar limites de alerta (temperatura + offline threshold).
export const salvarLimitesAlerta = createServerFn({ method: "POST" })
  .middleware([requireOperador])
  .inputValidator(
    (data: {
      bancada_id: string;
      temp_min: number | null;
      temp_max: number | null;
      offline_threshold_segundos: number;
    }) =>
      z
        .object({
          bancada_id: z.string().uuid(),
          temp_min: z.number().min(-50).max(200).nullable(),
          temp_max: z.number().min(-50).max(200).nullable(),
          offline_threshold_segundos: z.number().int().min(30).max(86400),
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
        temp_min: data.temp_min,
        temp_max: data.temp_max,
        offline_threshold_segundos: data.offline_threshold_segundos,
      })
      .eq("id", data.bancada_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Aplica um mesmo ciclo (config) a todas as bancadas — de um laboratório
// específico ou de TODA a instalação. Também enfileira UPDATE_CONFIG para
// cada uma, para o ESP32 receber no próximo poll.
export const aplicarConfigEmMassa = createServerFn({ method: "POST" })
  .middleware([requireOperador])
  .inputValidator(
    (data: {
      escopo: "todas" | "laboratorio";
      laboratorio_id?: string | null;
      config: Configuracoes;
    }) =>
      z
        .object({
          escopo: z.enum(["todas", "laboratorio"]),
          laboratorio_id: z.string().uuid().nullable().optional(),
          config: configSchema,
        })
        .parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    let query = supabaseAdmin.from("bancadas").select("id, config_version");
    if (data.escopo === "laboratorio") {
      if (!data.laboratorio_id) throw new Error("laboratorio_id obrigatório");
      query = query.eq("laboratorio_id", data.laboratorio_id);
    }
    const { data: rows, error: selErr } = await query;
    if (selErr) throw new Error(selErr.message);
    const alvos = rows ?? [];
    if (alvos.length === 0) return { ok: true, atualizadas: 0 };

    for (const b of alvos) {
      const nextVersion = ((b.config_version as number | null) ?? 0) + 1;
      const { error: upErr } = await supabaseAdmin
        .from("bancadas")
        .update({
          config: data.config as never,
          config_version: nextVersion,
        })
        .eq("id", b.id as string);
      if (upErr) throw new Error(upErr.message);

      const { error: cmdErr } = await supabaseAdmin.from("comandos").insert({
        bancada_id: b.id as string,
        tipo: "UPDATE_CONFIG",
        payload: data.config as never,
      });
      if (cmdErr) throw new Error(cmdErr.message);
    }

    return { ok: true, atualizadas: alvos.length };
  });

