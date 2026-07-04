import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppRole = "admin" | "operador" | "visualizador";

export interface UsuarioComPapeis {
  user_id: string;
  email: string | null;
  created_at: string;
  roles: AppRole[];
}

/** Retorna os papéis do usuário logado. Usado pelo cliente para gate de UI. */
export const meusPapeis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AppRole[]> => {
    const { data, error } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.role as AppRole);
  });

/** Lista todos os usuários com seus papéis. Apenas admin. */
export const listarUsuarios = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UsuarioComPapeis[]> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Acesso negado");

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: rolesData, error: rolesErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role");
    if (rolesErr) throw new Error(rolesErr.message);

    const { data: usersData, error: usersErr } =
      await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (usersErr) throw new Error(usersErr.message);

    return usersData.users.map((u) => ({
      user_id: u.id,
      email: u.email ?? null,
      created_at: u.created_at,
      roles: (rolesData ?? [])
        .filter((r) => r.user_id === u.id)
        .map((r) => r.role as AppRole),
    }));
  });

/** Concede um papel. Apenas admin. */
export const concederPapel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; role: AppRole }) =>
    z
      .object({
        user_id: z.string().uuid(),
        role: z.enum(["admin", "operador", "visualizador"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Acesso negado");

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.user_id, role: data.role });
    if (error && !error.message.includes("duplicate"))
      throw new Error(error.message);
    return { ok: true };
  });

/** Remove um papel. Apenas admin. Impede remover o próprio último admin. */
export const removerPapel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; role: AppRole }) =>
    z
      .object({
        user_id: z.string().uuid(),
        role: z.enum(["admin", "operador", "visualizador"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Acesso negado");

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    // Proteção: nunca deixar o sistema sem admin
    if (data.role === "admin") {
      const { count } = await supabaseAdmin
        .from("user_roles")
        .select("*", { count: "exact", head: true })
        .eq("role", "admin");
      if ((count ?? 0) <= 1)
        throw new Error("Não é possível remover o último admin");
    }

    const { error } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.user_id)
      .eq("role", data.role);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
