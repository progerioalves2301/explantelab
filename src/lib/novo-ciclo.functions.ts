import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireTecnico } from "@/lib/role-middleware";

/**
 * Inicia um Novo Ciclo de mudas para uma prateleira.
 *
 * Ação sensível — exige reconfirmação da senha do usuário logado.
 * Efeitos (todos em uma transação lógica):
 *   1. Encerra a muda ativa da prateleira (data_fim = now, ativa = false).
 *   2. Marca `bancadas.ciclo_iniciado_em = now()` — gráficos e relatórios
 *      passam a filtrar a partir desse marco.
 *   3. Envia comando PAUSE ao ESP (para o ciclo hidráulico em andamento).
 *   4. Envia comando SCALE_TARE se houver balança associada.
 *   5. Registra evento em `public.auditoria`.
 *
 * Histórico de medições (CO2, temperatura, peso) NÃO é apagado.
 */
export const iniciarNovoCiclo = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator(
    (input: { bancada_id: string; senha: string }) => {
      if (!input.bancada_id) throw new Error("bancada_id obrigatório");
      if (!input.senha || input.senha.length < 6) {
        throw new Error("Senha inválida");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const email = claims.email as string | undefined;
    if (!email) throw new Error("Usuário sem email — não é possível confirmar senha");

    // 1. Reconfirma a senha do usuário logado com um client efêmero.
    const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const url = process.env.SUPABASE_URL!;
    const authClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
            h.delete("Authorization");
          }
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });
    const { error: authErr } = await authClient.auth.signInWithPassword({
      email,
      password: data.senha,
    });
    if (authErr) {
      throw new Error("Senha incorreta");
    }
    // desconecta a sessão criada por esse client efêmero
    await authClient.auth.signOut().catch(() => {});

    // 2. Busca a prateleira (garante que o usuário tem acesso via RLS).
    const { data: bancada, error: bErr } = await supabase
      .from("bancadas")
      .select("id, nome, laboratorio_id")
      .eq("id", data.bancada_id)
      .maybeSingle();
    if (bErr) throw new Error(bErr.message);
    if (!bancada) throw new Error("Prateleira não encontrada");

    // 3. Encerra muda ativa (se houver).
    const { data: mudasEncerradas, error: mErr } = await supabase
      .from("mudas")
      .update({ ativa: false, data_fim: new Date().toISOString() })
      .eq("bancada_id", data.bancada_id)
      .eq("ativa", true)
      .select("id, identificador");
    if (mErr) throw new Error(`Falha ao encerrar muda: ${mErr.message}`);

    // 4. Marca início do novo ciclo.
    // Usa cliente admin pois RLS de `bancadas` só permite UPDATE para admin;
    // o papel do chamador (tecnico/admin) já foi validado por `requireTecnico`.
    const agora = new Date().toISOString();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: uErr } = await supabaseAdmin
      .from("bancadas")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ ciclo_iniciado_em: agora } as any)
      .eq("id", data.bancada_id);
    if (uErr) throw new Error(`Falha ao marcar ciclo: ${uErr.message}`);

    // 5. Comando PAUSE ao ESP (para ciclo hidráulico e coloca em repouso).
    await supabase.from("comandos").insert({
      bancada_id: data.bancada_id,
      tipo: "PAUSE",
      payload: { source: "novo_ciclo" },
    });

    // 6. Comando TARE para balança associada (se houver).
    let balancaTara: string | null = null;
    const { data: balanca } = await supabase
      .from("balancas")
      .select("id, bancada_associada_id")
      .eq("bancada_associada_id", data.bancada_id)
      .eq("ativa", true)
      .maybeSingle();
    if (balanca) {
      balancaTara = balanca.id;
      await supabase.from("comandos").insert({
        bancada_id: data.bancada_id,
        tipo: "SCALE_TARE",
        payload: { balanca_id: balanca.id, source: "novo_ciclo" },
      });
    }

    // 7. Auditoria LGPD.
    await supabase.from("auditoria").insert({
      usuario_id: userId,
      usuario_email: email,
      tabela: "bancadas",
      operacao: "NOVO_CICLO",
      registro_id: data.bancada_id,
      dados_novos: {
        ciclo_iniciado_em: agora,
        mudas_encerradas: mudasEncerradas ?? [],
        balanca_tara: balancaTara,
        prateleira: bancada.nome,
      },
    });

    return {
      ok: true as const,
      ciclo_iniciado_em: agora,
      mudas_encerradas: (mudasEncerradas ?? []).length,
      balanca_tara: balancaTara != null,
    };
  });
