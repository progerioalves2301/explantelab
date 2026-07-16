import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Permite apenas admin e operador. Visualizador é somente leitura e é bloqueado.
 * Use em todas as server functions que fazem escrita/comando.
 */
export const requireOperador = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    const { data: isOp } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "operador",
    });
    if (!isAdmin && !isOp) {
      throw new Error(
        "Acesso negado: visualizadores não podem alterar dados",
      );
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
