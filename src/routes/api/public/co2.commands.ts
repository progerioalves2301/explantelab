import { createFileRoute } from "@tanstack/react-router";

// Módulo dedicado de CO2 (firmware v3.0.0-co2) chama:
//   GET /api/public/co2/commands
//   Header: X-Device-Token: <token do sensor>
//   Header opcional: X-Firmware-Version
// Resposta: { ok: true } ou { ok: true, ota: { url, filename } }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/co2/commands")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = request.headers.get("x-device-token");
        if (!token) return json({ error: "missing token" }, 401);

        const fw = request.headers.get("x-firmware-version") ?? undefined;
        const ip =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          undefined;

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { data, error } = await supabaseAdmin.rpc("co2_pull_commands", {
          _device_token: token,
          ...(fw ? { _firmware_version: fw.slice(0, 32) } : {}),
          ...(ip ? { _ip_local: ip.slice(0, 64) } : {}),
        });
        if (error) {
          const msg = error.message.toLowerCase();
          if (msg.includes("invalid_token"))
            return json({ error: "invalid token" }, 401);
          return json({ error: error.message }, 500);
        }
        return json(data ?? { ok: true });
      },
    },
  },
});
