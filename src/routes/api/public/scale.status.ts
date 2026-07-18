import { createFileRoute } from "@tanstack/react-router";

// GET /api/public/scale/status
// Header: X-Device-Token: <token da balança>
// Retorna se a balança pode amostrar agora, respeitando ciclo hidráulico
// e janela de estabilização.

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/scale/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = request.headers.get("x-device-token");
        if (!token) return json({ error: "missing token" }, 401);

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { data, error } = await supabaseAdmin.rpc("scale_can_sample", {
          _device_token: token,
        });
        if (error) {
          const msg = error.message.toLowerCase();
          if (msg.includes("invalid_token")) return json({ error: "invalid token" }, 401);
          return json({ error: error.message }, 500);
        }
        return json(data);
      },
    },
  },
});
