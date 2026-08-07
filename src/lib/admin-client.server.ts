/** Carrega o cliente privilegiado (service role) com mensagem clara em PT-BR
 *  quando a chave não está configurada no ambiente (ex.: deploy sem
 *  SUPABASE_SERVICE_ROLE_KEY). Server-only: nunca importar do cliente. */
export async function getSupabaseAdmin() {
  try {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    // Toca o proxy para forçar a validação das variáveis de ambiente agora.
    void supabaseAdmin.auth;
    return supabaseAdmin;
  } catch {
    throw new Error(
      "Esta ação exige a chave privilegiada do banco (SUPABASE_SERVICE_ROLE_KEY). " +
        "Configure-a nas variáveis de ambiente do servidor (ex.: Vercel > Settings > Environment Variables) e faça um novo deploy.",
    );
  }
}
