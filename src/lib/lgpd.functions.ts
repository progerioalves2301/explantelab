import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface DadosPessoaisExport {
  gerado_em: string;
  titular: {
    user_id: string;
    email: string | null;
    criado_em: string | null;
    ultimo_login: string | null;
  };
  papeis: { role: string }[];
  termos_aceites: { versao: string; aceito_em: string }[];
  auditoria_registros_do_titular: Array<{
    tabela: string;
    operacao: string;
    registro_id: string | null;
    criado_em: string;
  }>;
  comandos_emitidos: Array<{
    bancada_id: string;
    tipo: string;
    payload: unknown;
    criado_em: string;
  }>;
  alertas_resolvidos_por_titular: Array<{
    id: string;
    tipo: string;
    mensagem: string;
    resolvido_em: string;
  }>;
  observacoes: string;
}

async function coletarDadosPessoais(
  userId: string,
): Promise<DadosPessoaisExport> {
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const [{ data: userInfo }, { data: roles }, { data: termos }, { data: audit }] =
    await Promise.all([
      supabaseAdmin.auth.admin.getUserById(userId),
      supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
      supabaseAdmin
        .from("termos_aceites")
        .select("versao, aceito_em")
        .eq("user_id", userId),
      supabaseAdmin
        .from("auditoria")
        .select("tabela, operacao, registro_id, criado_em")
        .eq("usuario_id", userId)
        .order("criado_em", { ascending: false })
        .limit(1000),
    ]);

  // Comandos emitidos pelo titular (extraídos da auditoria)
  const comandoIds =
    (audit ?? [])
      .filter((a) => a.tabela === "comandos" && a.operacao === "INSERT")
      .map((a) => a.registro_id as string)
      .filter(Boolean) ?? [];
  let comandos: DadosPessoaisExport["comandos_emitidos"] = [];
  if (comandoIds.length) {
    const { data } = await supabaseAdmin
      .from("comandos")
      .select("bancada_id, tipo, payload, created_at")
      .in("id", comandoIds.slice(0, 500));
    comandos = (data ?? []).map((c) => ({
      bancada_id: c.bancada_id as string,
      tipo: c.tipo as string,
      payload: c.payload as unknown,
      criado_em: c.created_at as string,
    }));
  }

  return {
    gerado_em: new Date().toISOString(),
    titular: {
      user_id: userId,
      email: userInfo?.user?.email ?? null,
      criado_em: userInfo?.user?.created_at ?? null,
      ultimo_login: userInfo?.user?.last_sign_in_at ?? null,
    },
    papeis: (roles ?? []).map((r) => ({ role: r.role as string })),
    termos_aceites: (termos ?? []).map((t) => ({
      versao: t.versao as string,
      aceito_em: t.aceito_em as string,
    })),
    auditoria_registros_do_titular: (audit ?? []).map((a) => ({
      tabela: a.tabela as string,
      operacao: a.operacao as string,
      registro_id: (a.registro_id as string | null) ?? null,
      criado_em: a.criado_em as string,
    })),
    comandos_emitidos: comandos,
    alertas_resolvidos_por_titular: [],
    observacoes:
      "Este arquivo contém os dados pessoais associados à sua conta VitroCeres, nos termos da LGPD (Lei 13.709/2018), art. 18, incisos II e V.",
  };
}

/** LGPD art. 18, II – Portabilidade. Retorna JSON estruturado. */
export const exportarMeusDados = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { formato?: "json" | "csv" | "pdf" } | undefined) => d ?? {})
  .handler(async ({ data, context }) => {
    const formato = data.formato ?? "json";
    const dados = await coletarDadosPessoais(context.userId);

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    await supabaseAdmin.from("solicitacoes_lgpd").insert({
      user_id: context.userId,
      tipo: "exportacao",
      formato,
      status: "concluida",
    });

    return dados;
  });

/** LGPD art. 18, V – Portabilidade a outro fornecedor. Gera link assinado (24h). */
export const gerarLinkTransferencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const dados = await coletarDadosPessoais(context.userId);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const filename = `${context.userId}/transferencia_${Date.now()}.json`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("lgpd-exports")
      .upload(filename, JSON.stringify(dados, null, 2), {
        contentType: "application/json",
        upsert: false,
      });
    if (upErr) throw new Error(upErr.message);

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from("lgpd-exports")
      .createSignedUrl(filename, 60 * 60 * 24); // 24h
    if (signErr || !signed) throw new Error(signErr?.message ?? "erro ao assinar");

    await supabaseAdmin.from("solicitacoes_lgpd").insert({
      user_id: context.userId,
      tipo: "transferencia",
      formato: "json",
      status: "concluida",
      storage_path: filename,
      detalhes: { expira_em_horas: 24 },
    });

    const expiraEm = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    return { url: signed.signedUrl, expira_em: expiraEm };
  });

export interface SolicitacaoLgpd {
  id: string;
  tipo: string;
  formato: string | null;
  status: string;
  storage_path: string | null;
  created_at: string;
}

/** Histórico de solicitações LGPD do titular (art. 19 – prazo de atendimento). */
export const listarMinhasSolicitacoes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SolicitacaoLgpd[]> => {
    const { data } = await context.supabase
      .from("solicitacoes_lgpd")
      .select("id, tipo, formato, status, storage_path, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    return (data ?? []) as SolicitacaoLgpd[];
  });

/** LGPD art. 18, VI – Eliminação. */
export const excluirMinhaConta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: minhasRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const souAdmin = (minhasRoles ?? []).some((r) => r.role === "admin");
    if (souAdmin) {
      const { count } = await supabaseAdmin
        .from("user_roles")
        .select("*", { count: "exact", head: true })
        .eq("role", "admin");
      if ((count ?? 0) <= 1)
        throw new Error(
          "Você é o último administrador. Nomeie outro admin antes de excluir sua conta.",
        );
    }

    await supabaseAdmin.from("solicitacoes_lgpd").insert({
      user_id: context.userId,
      tipo: "exclusao",
      status: "concluida",
    });

    await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", context.userId);
    await supabaseAdmin
      .from("termos_aceites")
      .delete()
      .eq("user_id", context.userId);

    const { error } = await supabaseAdmin.auth.admin.deleteUser(context.userId);
    if (error) throw new Error(error.message);

    return { ok: true };
  });
