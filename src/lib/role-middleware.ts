import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Após o rename de papéis (UI):
 *   - DB "admin"        → Administrador
 *   - DB "operador"     → Técnico
 *   - DB "visualizador" → Operador
 *
 * Regra atual: Administrador, Técnico e Operador podem executar operações
 * manuais (ciclos, stop, movimentação). Apenas usuários sem papel são
 * bloqueados.
 */
export const requireOperador = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { data, error } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    const roles = (data ?? []).map((r) => r.role as string);
    const permitido = roles.some((r) =>
      r === "admin" || r === "operador" || r === "visualizador",
    );
    if (!permitido) {
      throw new Error("Acesso negado: usuário sem papel atribuído");
    }
    return next({ context });
  });

/** Permite apenas admin. */
export const requireAdmin = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Acesso negado: requer administrador");
    return next({ context });
  });
