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
  observacoes: string;
}

/** LGPD art. 18, II – Portabilidade. Exporta todos os dados pessoais do titular logado. */
export const exportarMeusDados = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DadosPessoaisExport> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: userInfo } = await supabaseAdmin.auth.admin.getUserById(
      context.userId,
    );

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);

    const { data: termos } = await supabaseAdmin
      .from("termos_aceites")
      .select("versao, aceito_em")
      .eq("user_id", context.userId);

    const { data: audit } = await supabaseAdmin
      .from("auditoria")
      .select("tabela, operacao, registro_id, created_at")
      .eq("usuario_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1000);

    return {
      gerado_em: new Date().toISOString(),
      titular: {
        user_id: context.userId,
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
        created_at: a.created_at as string,
      })),
      observacoes:
        "Este arquivo contém os dados pessoais associados à sua conta VitroCeres, nos termos da LGPD (Lei 13.709/2018), art. 18, incisos II e V.",
    };
  });

/** LGPD art. 18, VI – Eliminação. Excluí a própria conta e dados pessoais associados. */
export const excluirMinhaConta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    // Proteção: nunca deixar o sistema sem admin
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

    // Remove papéis e termos aceitos (auditoria é preservada para rastro legal)
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
