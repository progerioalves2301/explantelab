import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// ESP32 chama uma única vez, após conectar ao Wi-Fi:
//   POST /api/public/bench/pair
//   Body: { pairing_code: "123456" }
// Retorna { bancada_id, device_token } — o firmware salva em Preferences.

const bodySchema = z.object({
  pairing_code: z.string().regex(/^\d{6}$/),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/bench/pair")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed;
        try {
          parsed = bodySchema.parse(await request.json());
        } catch (e) {
          return json({ error: "invalid payload", detail: String(e) }, 400);
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { data: secret, error } = await supabaseAdmin
          .from("bancada_secrets")
          .select("bancada_id, device_token, pairing_expires_at, paired_at")
          .eq("pairing_code", parsed.pairing_code)
          .maybeSingle();
        if (error) return json({ error: "db error" }, 500);
        if (!secret) return json({ error: "invalid code" }, 404);

        if (
          secret.pairing_expires_at &&
          new Date(secret.pairing_expires_at).getTime() < Date.now()
        ) {
          return json({ error: "expired code" }, 410);
        }

        // Consome o código: limpa pairing_code para que não sirva mais.
        await supabaseAdmin
          .from("bancada_secrets")
          .update({
            pairing_code: null,
            pairing_expires_at: null,
            paired_at: new Date().toISOString(),
          })
          .eq("bancada_id", secret.bancada_id);

        return json({
          bancada_id: secret.bancada_id,
          device_token: secret.device_token,
        });
      },
    },
  },
});
