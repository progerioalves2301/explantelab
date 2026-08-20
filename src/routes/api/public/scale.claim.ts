import { createFileRoute } from "@tanstack/react-router";

// O ESP32 da prateleira busca automaticamente a credencial da balança
// associada, usando apenas o token obtido no pareamento da prateleira.
//   GET /api/public/scale/claim
//   Header: X-Device-Token: <token da prateleira>
// Resposta: { device_token } da balança ativa associada, ou 404.

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/scale/claim")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = request.headers.get("x-device-token");
        if (!token || token.length < 8) return json({ error: "missing token" }, 401);

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { data: secret, error: secretError } = await supabaseAdmin
          .from("bancada_secrets")
          .select("bancada_id")
          .eq("device_token", token)
          .maybeSingle();
        if (secretError) return json({ error: "db error" }, 500);
        if (!secret) return json({ error: "invalid token" }, 401);

        const { data: balanca, error } = await supabaseAdmin
          .from("balancas")
          .select("id, device_token")
          .eq("bancada_associada_id", secret.bancada_id)
          .eq("ativa", true)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (error) return json({ error: "db error" }, 500);
        if (!balanca) return json({ error: "no scale" }, 404);

        await supabaseAdmin
          .from("balancas")
          .update({
            paired_at: new Date().toISOString(),
            pairing_code: null,
            pairing_expires_at: null,
          })
          .eq("id", balanca.id);

        return json({ balanca_id: balanca.id, device_token: balanca.device_token });
      },
    },
  },
});
