import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bodySchema = z.object({
  pairing_code: z.string().regex(/^\d{6}$/),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/scale/pair")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed: z.infer<typeof bodySchema>;
        try {
          parsed = bodySchema.parse(await request.json());
        } catch {
          return json({ error: "invalid payload" }, 400);
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { data: balanca, error } = await supabaseAdmin
          .from("balancas")
          .select("id, device_token, pairing_expires_at")
          .eq("pairing_code", parsed.pairing_code)
          .eq("ativa", true)
          .maybeSingle();

        if (error) return json({ error: "db error" }, 500);
        if (!balanca) return json({ error: "invalid code" }, 404);
        if (
          balanca.pairing_expires_at &&
          new Date(balanca.pairing_expires_at).getTime() < Date.now()
        ) {
          return json({ error: "expired code" }, 410);
        }

        const { error: updateError } = await supabaseAdmin
          .from("balancas")
          .update({
            pairing_code: null,
            pairing_expires_at: null,
            paired_at: new Date().toISOString(),
          })
          .eq("id", balanca.id);
        if (updateError) return json({ error: "db error" }, 500);

        return json({
          balanca_id: balanca.id,
          device_token: balanca.device_token,
        });
      },
    },
  },
});