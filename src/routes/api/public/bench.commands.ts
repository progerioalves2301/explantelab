import { createFileRoute } from "@tanstack/react-router";

// ESP32 chama:
//   GET /api/public/bench/commands
//   Header: X-Device-Token: <token>
// Retorna comandos pendentes e marca como entregues.

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/bench/commands")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = request.headers.get("x-device-token");
        if (!token) return json({ error: "missing token" }, 401);

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { data: secret } = await supabaseAdmin
          .from("bancada_secrets")
          .select("bancada_id")
          .eq("device_token", token)
          .maybeSingle();
        if (!secret) return json({ error: "invalid token" }, 401);

        const { data: comandos, error } = await supabaseAdmin
          .from("comandos")
          .select("id, tipo, payload, created_at")
          .eq("bancada_id", secret.bancada_id)
          .is("entregue_em", null)
          .order("created_at", { ascending: true })
          .limit(10);
        if (error) return json({ error: error.message }, 500);

        if (comandos && comandos.length > 0) {
          const ids = comandos.map((c) => c.id);
          await supabaseAdmin
            .from("comandos")
            .update({ entregue_em: new Date().toISOString() })
            .in("id", ids);
        }

        return json({ comandos: comandos ?? [] });
      },
    },
  },
});
