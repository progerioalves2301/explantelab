import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Módulo de CO2 chama uma única vez, após conectar ao Wi-Fi:
//   POST /api/public/co2/pair   Body: { pairing_code: "123456" }
// Retorna { sensor_id, device_token } — o firmware salva em Preferences.

const bodySchema = z.object({
  pairing_code: z.string().regex(/^\d{6}$/),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/co2/pair")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed;
        try {
          parsed = bodySchema.parse(await request.json());
        } catch {
          return json({ error: "invalid payload" }, 400);
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { data: sensor, error } = await supabaseAdmin
          .from("sensores_co2")
          .select("id, device_token, pairing_expires_at")
          .eq("pairing_code", parsed.pairing_code)
          .maybeSingle();
        if (error) return json({ error: "db error" }, 500);
        if (!sensor) return json({ error: "invalid code" }, 404);
        if (
          sensor.pairing_expires_at &&
          new Date(sensor.pairing_expires_at).getTime() < Date.now()
        ) {
          return json({ error: "expired code" }, 410);
        }

        // Consome o código para que não sirva mais.
        await supabaseAdmin
          .from("sensores_co2")
          .update({
            pairing_code: null,
            pairing_expires_at: null,
            paired_at: new Date().toISOString(),
          })
          .eq("id", sensor.id);

        return json({
          sensor_id: sensor.id,
          device_token: sensor.device_token,
        });
      },
    },
  },
});
