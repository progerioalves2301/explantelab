import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// ESP32 do sensor de CO2 chama:
//   POST /api/public/co2/reading
//   Header: X-Device-Token: <token>
//   Body: { ppm: number }

const bodySchema = z.object({
  ppm: z.number().min(0).max(50000),
  // Firmware dedicado do CO2 (v3.0.0-co2) manda também temperatura/umidade do
  // SCD41. Campos opcionais para manter compatibilidade com firmwares antigos.
  temperatura_c: z.number().min(-50).max(125).nullable().optional(),
  umidade_pct: z.number().min(0).max(100).nullable().optional(),
  firmware_version: z.string().max(32).optional(),
  ip_local: z.string().max(64).optional(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/co2/reading")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-device-token");
        if (!token) return json({ error: "missing token" }, 401);

        let payload;
        try {
          payload = bodySchema.parse(await request.json());
        } catch (e) {
          return json({ error: "invalid payload", detail: String(e) }, 400);
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { data, error } = await supabaseAdmin.rpc("co2_push_reading", {
          _device_token: token,
          _ppm: payload.ppm,
          ...(payload.temperatura_c != null
            ? { _temperatura_c: payload.temperatura_c }
            : {}),
          ...(payload.umidade_pct != null
            ? { _umidade_pct: payload.umidade_pct }
            : {}),
          ...(payload.firmware_version
            ? { _firmware_version: payload.firmware_version }
            : {}),
          ...(payload.ip_local ? { _ip_local: payload.ip_local } : {}),
        });
        if (error) {
          const msg = error.message.toLowerCase();
          if (msg.includes("invalid_token"))
            return json({ error: "invalid token" }, 401);
          return json({ error: error.message }, 500);
        }
        return json({ ok: true, result: data });
      },
    },
  },
});
