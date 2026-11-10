import { createFileRoute } from "@tanstack/react-router";

// v2.6.21 — ponte para as funções de IR que o firmware chamava direto no
// Supabase (/rest/v1/rpc/<fn>). Assim o ESP32 só conhece o domínio do app e
// a troca de banco não exige regravar as placas.
//
// ESP32 chama:
//   POST /api/public/bench/rpc/<fn>
//   Body: o mesmo JSON de antes (inclui _bancada_id e _device_token, que a
//         própria função do banco valida).
//
// Só as funções da lista abaixo passam; qualquer outra recebe 404.

const PERMITIDAS = new Set([
  "bench_ir_debug",
  "bench_ir_save_raw",
  "bench_ir_save_raw_heat",
  "bench_ir_save_raw_off",
]);

export const Route = createFileRoute("/api/public/bench/rpc/$fn")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const fn = params.fn;
        if (!PERMITIDAS.has(fn)) {
          return Response.json({ error: "função não permitida" }, { status: 404 });
        }

        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!url || !key) {
          return Response.json({ error: "servidor sem SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY" }, { status: 500 });
        }

        const body = await request.text();
        const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: key,
            Authorization: `Bearer ${key}`,
          },
          body,
        });

        return new Response(await res.text(), {
          status: res.status,
          headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
        });
      },
    },
  },
});
