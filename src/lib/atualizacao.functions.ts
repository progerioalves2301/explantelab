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
    const { data, error } = await context.supabase.storage
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
    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    const { error } = await context.supabase.storage
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
    const { error } = await context.supabase.storage
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
    const { data, error } = await context.supabase
      .from("bancadas")
      .select("id, nome, firmware_version, status, ip_local, ultima_sync")
      .order("nome", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as BancadaFirmwareInfo[];
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assinarUrlOta(sb: any, filename: string): Promise<string> {
  const { data, error } = await sb.storage
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
    const url = await assinarUrlOta(context.supabase, data.filename);
    const { error } = await context.supabase.from("comandos").insert({
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
    const url = await assinarUrlOta(context.supabase, data.filename);
    const { data: bs, error: bErr } = await context.supabase
      .from("bancadas")
      .select("id");
    if (bErr) throw new Error(bErr.message);
    const rows = (bs ?? []).map((b) => ({
      bancada_id: b.id,
      tipo: "OTA_UPDATE" as const,
      payload: { url, filename: data.filename } as never,
    }));
    if (rows.length === 0) return { ok: true, total: 0 };
    const { error } = await context.supabase.from("comandos").insert(rows);
    if (error) throw new Error(error.message);
    return { ok: true, total: rows.length };
  });

/** Cancela um comando OTA pendente para uma bancada. Apenas admin. */
export const cancelaOtaBancada = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { bancada_id: string }) =>
    z.object({ bancada_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    // Remove comandos OTA_UPDATE ainda não entregues para esta bancada
    const { error } = await context.supabase
      .from("comandos")
      .delete()
      .eq("bancada_id", data.bancada_id)
      .eq("tipo", "OTA_UPDATE")
      .is("entregue_em", null);

    if (error) throw new Error(error.message);

    // Enfileira um comando de cancelamento explícito caso o ESP já tenha pego a URL mas não começado o flash
    await context.supabase.from("comandos").insert({
      bancada_id: data.bancada_id,
      tipo: "OTA_CANCEL",
      payload: {} as never,
    });

    return { ok: true };
  });

/** Cancela comandos OTA pendentes para todas as bancadas. Apenas admin. */
export const cancelaOtaTodas = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("comandos")
      .delete()
      .eq("tipo", "OTA_UPDATE")
      .is("entregue_em", null);

    if (error) throw new Error(error.message);

    const { data: bs } = await context.supabase.from("bancadas").select("id");
    if (bs && bs.length > 0) {
      const rows = bs.map((b) => ({
        bancada_id: b.id,
        tipo: "OTA_CANCEL" as const,
        payload: {} as never,
      }));
      await context.supabase.from("comandos").insert(rows);
    }

    return { ok: true };
  });

// ===================== Sensores de CO2 (firmware dedicado) =====================
// O módulo de CO2 não é uma prateleira: ele não usa a tabela `comandos`.
// O OTA fica registrado no próprio sensor e é entregue quando o firmware
// consulta GET /api/public/co2/commands.

export interface SensorCo2FirmwareInfo {
  id: string;
  nome: string;
  firmware_version: string | null;
  ip_local: string | null;
  ultima_medicao_em: string | null;
  ativo: boolean;
  ota_filename: string | null;
  ota_solicitado_em: string | null;
  ota_entregue_em: string | null;
}

/** Sensores de CO2 + firmware atual (tela de OTA). Apenas admin. */
export const listarSensoresCo2ParaOta = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SensorCo2FirmwareInfo[]> => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("sensores_co2")
      .select(
        "id, nome, firmware_version, ip_local, ultima_medicao_em, ativo, ota_filename, ota_solicitado_em, ota_entregue_em",
      )
      .order("nome", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SensorCo2FirmwareInfo[];
  });

/** Agenda OTA para um sensor de CO2. Apenas admin. */
export const disparaOtaSensorCo2 = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { sensor_id: string; filename: string }) =>
    z
      .object({ sensor_id: z.string().uuid(), filename: z.string().min(1) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const url = await assinarUrlOta(context.supabase, data.filename);
    const { error } = await context.supabase
      .from("sensores_co2")
      .update({
        ota_url: url,
        ota_filename: data.filename,
        ota_solicitado_em: new Date().toISOString(),
        ota_entregue_em: null,
      })
      .eq("id", data.sensor_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Cancela o OTA pendente de um sensor de CO2. Apenas admin. */
export const cancelaOtaSensorCo2 = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { sensor_id: string }) =>
    z.object({ sensor_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("sensores_co2")
      .update({
        ota_url: null,
        ota_filename: null,
        ota_solicitado_em: null,
        ota_entregue_em: null,
      })
      .eq("id", data.sensor_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
