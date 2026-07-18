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

/** Cria novo usuário. Apenas admin. Email confirmado automaticamente. */
export const criarUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; password: string; role: AppRole }) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(6, "Senha deve ter no mínimo 6 caracteres"),
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
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    if (!created.user) throw new Error("Falha ao criar usuário");

    // Remove papel default do trigger e aplica o escolhido
    await supabaseAdmin.from("user_roles").delete().eq("user_id", created.user.id);
    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: created.user.id, role: data.role });
    if (roleErr) throw new Error(roleErr.message);
    return { ok: true, user_id: created.user.id };
  });

/** Remove usuário completamente. Apenas admin. Não permite auto-remoção. */
export const removerUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string }) =>
    z.object({ user_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Acesso negado");
    if (data.user_id === context.userId)
      throw new Error("Não é possível remover seu próprio usuário");

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    // Proteção: nunca deixar o sistema sem admin
    const { data: userRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);
    const isTargetAdmin = (userRoles ?? []).some((r) => r.role === "admin");
    if (isTargetAdmin) {
      const { count } = await supabaseAdmin
        .from("user_roles")
        .select("*", { count: "exact", head: true })
        .eq("role", "admin");
      if ((count ?? 0) <= 1)
        throw new Error("Não é possível remover o último admin");
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Redefine a senha de um usuário. Apenas admin.
 *  A senha nova NUNCA é armazenada em texto plano (Supabase Auth aplica hash bcrypt).
 *  A operação é registrada na tabela auditoria (art. 37 LGPD) via trigger. */
export const redefinirSenha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; nova_senha: string }) =>
    z
      .object({
        user_id: z.string().uuid(),
        nova_senha: z
          .string()
          .min(8, "Senha deve ter no mínimo 8 caracteres")
          .regex(/[A-Z]/, "Senha deve conter ao menos 1 letra maiúscula")
          .regex(/[a-z]/, "Senha deve conter ao menos 1 letra minúscula")
          .regex(/[0-9]/, "Senha deve conter ao menos 1 número"),
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
    const { error } = await supabaseAdmin.auth.admin.updateUserById(
      data.user_id,
      { password: data.nova_senha },
    );
    if (error) throw new Error(error.message);

    // Registro de auditoria (art. 37 LGPD) — nunca gravamos a senha
    await supabaseAdmin.from("auditoria").insert({
      usuario_id: context.userId,
      tabela: "auth.users",
      operacao: "PASSWORD_RESET",
      registro_id: data.user_id,
      dados_novos: { evento: "senha_redefinida_por_admin" },
    });

    return { ok: true };
  });

