import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// ESP32 da balança HX711 chama:
//   POST /api/public/scale/reading
//   Header: X-Device-Token: <token da balança>
//   Body: { valor_g: number, muda_identificador?: string }
//
// Se muda_identificador for informado e existir ativa no laboratório da
// balança, a leitura é gravada em medicoes_peso; caso contrário, apenas
// atualiza ultima_leitura_g na balança (leitura ao vivo).

const bodySchema = z.object({
  valor_g: z.number().min(0).max(100000),
  muda_identificador: z.string().max(64).optional().nullable(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/scale/reading")({
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

        const { data, error } = await supabaseAdmin.rpc("scale_push_reading", {
          _device_token: token,
          _muda_identificador: payload.muda_identificador ?? "",
          _valor_g: payload.valor_g,
        });
        if (error) {
          const msg = error.message.toLowerCase();
          if (msg.includes("invalid_token")) return json({ error: "invalid token" }, 401);
          return json({ error: error.message }, 500);
        }
        return json({ ok: true, result: data });
      },
    },
  },
});
