import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/lib/role-middleware";

const BUCKET = "firmware";
const SIGNED_URL_TTL_SEC = 3600; // 1h

export interface FirmwareItem {
  name: string;
  size: number;
  updated_at: string | null;
  created_at: string | null;
}

export interface BancadaFirmwareInfo {
  id: string;
  nome: string;
  firmware_version: string | null;
  status: string;
  ip_local: string | null;
  ultima_sync: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(context: any) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!data) throw new Error("Acesso negado — apenas administradores.");
}

/** Lista os firmwares .bin disponíveis no bucket privado. Apenas admin. */
export const listarFirmwares = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FirmwareItem[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .list("", { limit: 200, sortBy: { column: "created_at", order: "desc" } });
    if (error) throw new Error(error.message);
    return (data ?? [])
      .filter((f) => f.name.toLowerCase().endsWith(".bin"))
      .map((f) => ({
        name: f.name,
        size: (f.metadata?.size as number | undefined) ?? 0,
        updated_at: f.updated_at ?? null,
        created_at: f.created_at ?? null,
      }));
  });

/** Faz upload de um firmware .bin (base64). Apenas admin. */
export const uploadFirmware = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(
    (d: { filename: string; base64: string; contentType?: string }) =>
      z
        .object({
          filename: z
            .string()
            .min(1)
            .max(120)
            .regex(/^[A-Za-z0-9._-]+\.bin$/i, "Nome inválido (use .bin)"),
          base64: z.string().min(10),
          contentType: z.string().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(data.filename, bytes, {
        contentType: data.contentType ?? "application/octet-stream",
        upsert: true,
      });
    if (error) throw new Error(error.message);
    return { ok: true, size: bytes.byteLength };
  });

/** Apaga um firmware do bucket. Apenas admin. */
export const deletarFirmware = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { filename: string }) =>
    z.object({ filename: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .remove([data.filename]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Bancadas + firmware atual (para tela de OTA). Apenas admin. */
export const listarBancadasParaOta = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BancadaFirmwareInfo[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await supabaseAdmin
      .from("bancadas")
      .select("id, nome, firmware_version, status, ip_local, ultima_sync")
      .order("nome", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as BancadaFirmwareInfo[];
  });

async function assinarUrlOta(filename: string): Promise<string> {
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(filename, SIGNED_URL_TTL_SEC);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Falha ao gerar URL do firmware");
  }
  return data.signedUrl;
}

/** Dispara OTA_UPDATE para uma bancada. Apenas admin. */
export const disparaOtaBancada = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { bancada_id: string; filename: string }) =>
    z
      .object({
        bancada_id: z.string().uuid(),
        filename: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const url = await assinarUrlOta(data.filename);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin.from("comandos").insert({
      bancada_id: data.bancada_id,
      tipo: "OTA_UPDATE",
      payload: { url, filename: data.filename } as never,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Dispara OTA_UPDATE para todas as bancadas. Apenas admin. */
export const disparaOtaTodas = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { filename: string }) =>
    z.object({ filename: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const url = await assinarUrlOta(data.filename);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: bs, error: bErr } = await supabaseAdmin
      .from("bancadas")
      .select("id");
    if (bErr) throw new Error(bErr.message);
    const rows = (bs ?? []).map((b) => ({
      bancada_id: b.id,
      tipo: "OTA_UPDATE" as const,
      payload: { url, filename: data.filename } as never,
    }));
    if (rows.length === 0) return { ok: true, total: 0 };
    const { error } = await supabaseAdmin.from("comandos").insert(rows);
    if (error) throw new Error(error.message);
    return { ok: true, total: rows.length };
  });
