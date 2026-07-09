import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { Database, Json } from "@/integrations/supabase/types";

type BancadaUpdate = Database["public"]["Tables"]["bancadas"]["Update"];

// ESP32 chama:
//   POST /api/public/bench/telemetry
//   Header: X-Device-Token: <token>
//   Body: { status, valvulas, proximo_ciclo_segundos, firmware_version?, ip_local?, temperatura_planta? }

const telemetrySchema = z.object({
  status: z.enum([
    "Repouso",
    "Injetando",
    "Pausado",
    "Retornando",
    "Alivio",
    "Manual",
    "Offline",
  ]),
  valvulas: z.object({
    v1: z.boolean(),
    v2: z.boolean(),
    v3: z.boolean(),
    v4: z.boolean(),
    v5: z.boolean(),
  }),
  proximo_ciclo_segundos: z.number().int().min(0).max(86400 * 7),
  firmware_version: z.string().max(32).optional(),
  ip_local: z.string().max(64).optional(),
  temperatura_planta: z.number().min(-50).max(125).nullable().optional(),
  temperatura_valida: z.boolean().optional(),
  luz_ligada: z.boolean().optional(),
  tem_rtc: z.boolean().optional(),
  sensor_travado: z.boolean().optional(),
  sensor_reinicios: z.number().int().min(0).max(1_000_000).optional(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/bench/telemetry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-device-token");
        if (!token) return json({ error: "missing token" }, 401);

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { data: secret, error: secErr } = await supabaseAdmin
          .from("bancada_secrets")
          .select("bancada_id")
          .eq("device_token", token)
          .maybeSingle();
        if (secErr) return json({ error: "db error" }, 500);
        if (!secret) return json({ error: "invalid token" }, 401);

        let payload;
        try {
          payload = telemetrySchema.parse(await request.json());
        } catch (e) {
          return json({ error: "invalid payload", detail: String(e) }, 400);
        }

        const updatePayload: BancadaUpdate = {
          status: payload.status,
          valvulas: payload.valvulas as Json,
          proximo_ciclo_segundos: payload.proximo_ciclo_segundos,
          ultima_sync: new Date().toISOString(),
        };

        if (payload.firmware_version !== undefined) {
          updatePayload.firmware_version = payload.firmware_version;
        }
        if (payload.ip_local !== undefined) {
          updatePayload.ip_local = payload.ip_local;
        }
        if (payload.luz_ligada !== undefined) {
          updatePayload.luz_ligada = payload.luz_ligada;
        }
        if (payload.tem_rtc !== undefined) {
          updatePayload.tem_rtc = payload.tem_rtc;
        }
        if (payload.sensor_reinicios !== undefined) {
          updatePayload.sensor_reinicios = payload.sensor_reinicios;
        }
        if (payload.sensor_travado !== undefined) {
          updatePayload.sensor_travado = payload.sensor_travado;
        }

        if (
          payload.temperatura_valida === true &&
          payload.temperatura_planta != null
        ) {
          updatePayload.temperatura_planta = payload.temperatura_planta;
          updatePayload.sensor_travado = false;
        } else if (payload.temperatura_planta !== undefined) {
          updatePayload.temperatura_planta = payload.temperatura_planta;
          if (payload.temperatura_planta != null) {
            updatePayload.sensor_travado = false;
          }
        }

        const { error: updErr } = await supabaseAdmin
          .from("bancadas")
          .update(updatePayload)
          .eq("id", secret.bancada_id);
        if (updErr) return json({ error: updErr.message }, 500);

        // Devolve config atual e versão pro ESP32 conferir.
        const { data: cfg } = await supabaseAdmin
          .from("bancadas")
          .select("config, config_version")
          .eq("id", secret.bancada_id)
          .single();

        return json({
          ok: true,
          config: cfg?.config ?? null,
          config_version: cfg?.config_version ?? 1,
        });
      },
    },
  },
});
