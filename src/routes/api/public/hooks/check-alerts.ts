import { createFileRoute } from "@tanstack/react-router";

// Chamada pelo pg_cron a cada minuto. Detecta condições anômalas,
// insere alertas em `alertas` e envia notificações Telegram para
// os `alerta_destinos` ativos.
export const Route = createFileRoute("/api/public/hooks/check-alerts")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // 1. rodar detecção (SECURITY DEFINER)
        const { error: detErr } = await supabaseAdmin.rpc("detectar_alertas");
        if (detErr) {
          return Response.json({ error: detErr.message }, { status: 500 });
        }

        // 1b. rodar controle automático dos ar-condicionados (enfileira comandos AC_CONTROL)
        const { error: acErr } = await supabaseAdmin.rpc("decidir_ar_condicionado");
        if (acErr) {
          console.error("decidir_ar_condicionado falhou", acErr.message);
        }

        // 2. pegar alertas ainda não notificados
        const { data: pendentes, error: pendErr } = await supabaseAdmin
          .from("alertas")
          .select("id, tipo, severidade, mensagem, created_at, bancada_id, prateleiras(nome)")
          .is("notificado_em", null)
          .is("resolvido_em", null)
          .order("created_at", { ascending: true })
          .limit(50);
        if (pendErr) {
          return Response.json({ error: pendErr.message }, { status: 500 });
        }

        if (!pendentes || pendentes.length === 0) {
          return Response.json({ ok: true, novos: 0, enviados: 0 });
        }

        // 3. destinos ativos
        const { data: destinos } = await supabaseAdmin
          .from("alerta_destinos")
          .select("chat_id")
          .eq("ativo", true);

        const lovableKey = process.env.LOVABLE_API_KEY;
        const tgKey = process.env.TELEGRAM_API_KEY;
        const canSend = !!(lovableKey && tgKey && destinos && destinos.length > 0);

        let enviados = 0;
        const ids: string[] = [];

        for (const alerta of pendentes as any[]) {
          ids.push(alerta.id);
          if (!canSend) continue;

          const emoji = alerta.severidade === "critical" ? "🚨" : "⚠️";
          const tipoLabel =
            alerta.tipo === "offline" ? "OFFLINE" :
            alerta.tipo === "temperatura" ? "TEMPERATURA" : "CICLO";
          const text = `${emoji} <b>Explante Lab — ${tipoLabel}</b>\n${alerta.mensagem}`;

          for (const d of destinos!) {
            try {
              const res = await fetch("https://connector-gateway.lovable.dev/telegram/sendMessage", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${lovableKey}`,
                  "X-Connection-Api-Key": tgKey!,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  chat_id: d.chat_id,
                  text,
                  parse_mode: "HTML",
                }),
              });
              if (res.ok) enviados++;
              else console.error("Telegram falhou", res.status, await res.text());
            } catch (e) {
              console.error("Erro enviando Telegram", e);
            }
          }
        }

        // 4. marcar como notificados (mesmo sem destinos, para não empilhar)
        await supabaseAdmin
          .from("alertas")
          .update({ notificado_em: new Date().toISOString() })
          .in("id", ids);

        // 5. alertas RESOLVIDOS que ainda não notificaram recuperação
        const { data: resolvidos } = await supabaseAdmin
          .from("alertas")
          .select("id, tipo, mensagem, bancada_id, prateleiras(nome)")
          .not("resolvido_em", "is", null)
          .not("notificado_em", "is", null)
          .is("notificado_resolucao_em", null)
          .limit(50);

        let recuperados = 0;
        const resolvidosIds: string[] = [];

        if (resolvidos && resolvidos.length > 0) {
          for (const alerta of resolvidos as any[]) {
            resolvidosIds.push(alerta.id);
            if (!canSend) continue;

            const tipoLabel =
              alerta.tipo === "offline" ? "voltou ONLINE" :
              alerta.tipo === "temperatura" ? "TEMPERATURA normalizada" :
              "CICLO recuperado";
            const nome = alerta.bancadas?.nome ?? "Prateleira";
            const text = `✅ <b>Explante Lab — Recuperado</b>\nBancada "${nome}" ${tipoLabel}.`;

            for (const d of destinos!) {
              try {
                const res = await fetch("https://connector-gateway.lovable.dev/telegram/sendMessage", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${lovableKey}`,
                    "X-Connection-Api-Key": tgKey!,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ chat_id: d.chat_id, text, parse_mode: "HTML" }),
                });
                if (res.ok) recuperados++;
                else console.error("Telegram recuperação falhou", res.status, await res.text());
              } catch (e) {
                console.error("Erro enviando recuperação Telegram", e);
              }
            }
          }

          await supabaseAdmin
            .from("alertas")
            .update({ notificado_resolucao_em: new Date().toISOString() })
            .in("id", resolvidosIds);
        }

        return Response.json({
          ok: true,
          novos: pendentes.length,
          enviados,
          recuperados,
        });
      },
    },
  },
});
