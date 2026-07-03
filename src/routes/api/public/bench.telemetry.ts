import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// ESP32 chama:
//   POST /api/public/bench/telemetry
//   Header: X-Device-Token: <token>
//   Body: { status, valvulas, proximo_ciclo_segundos, firmware_version?, ip_local? }

const telemetrySchema = z.object({
  status: z.enum([
    "Repouso",
    "Injetando",
    "Pausado",
    "Retornando",
    "Alivio",
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

        const { error: updErr } = await supabaseAdmin
          .from("bancadas")
          .update({
            status: payload.status,
            valvulas: payload.valvulas,
            proximo_ciclo_segundos: payload.proximo_ciclo_segundos,
            firmware_version: payload.firmware_version ?? null,
            ip_local: payload.ip_local ?? null,
            ultima_sync: new Date().toISOString(),
          })
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
