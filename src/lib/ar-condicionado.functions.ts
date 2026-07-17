import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperador } from "@/lib/role-middleware";

export interface ArCondicionado {
  id: string;
  laboratorio_id: string;
  bancada_controladora_id: string | null;
  marca: string;
  modelo: string | null;
  ir_protocol: string;
  ativo: boolean;
  setpoint_min: number;
  setpoint_max: number;
  histerese: number;
  intervalo_min_comando_s: number;
  agregacao: "media" | "maxima";
  ligado: boolean;
  modo_atual: "off" | "cool" | "heat";
  setpoint_atual: number | null;
  ultimo_comando_em: string | null;
  ultimo_temp_lida: number | null;
  codigo_ir_raw: number[] | null;
  codigo_ir_raw_heat: number[] | null;
  suporta_aquecimento: boolean;
  created_at: string;
  updated_at: string;
}

export const PROTOCOLOS_IR = [
  { value: "RAW", label: "RAW (aprendido do controle original) — recomendado" },
  { value: "LG", label: "LG" },
  { value: "SAMSUNG", label: "Samsung" },
  { value: "FUJITSU", label: "Fujitsu" },
  { value: "MIDEA", label: "Midea / Springer (Midea-compat)" },
  { value: "ELECTROLUX", label: "Electrolux (Midea-compat)" },
  { value: "ELGIN", label: "Elgin (Midea-compat)" },
  { value: "ELECTRA", label: "Electra" },
  { value: "CONSUL", label: "Consul (Whirlpool)" },
] as const;

const arSchema = z.object({
  laboratorio_id: z.string().uuid(),
  bancada_controladora_id: z.string().uuid().nullable(),
  marca: z.string().min(1).max(40),
  modelo: z.string().max(60).nullable().optional(),
  ir_protocol: z.enum(["RAW", "LG", "SAMSUNG", "FUJITSU", "MIDEA", "ELECTROLUX", "ELGIN", "ELECTRA", "CONSUL"]),
  ativo: z.boolean(),
  setpoint_min: z.number().min(16).max(30),
  setpoint_max: z.number().min(16).max(30),
  histerese: z.number().min(0.1).max(5),
  intervalo_min_comando_s: z.number().int().min(30).max(3600),
  agregacao: z.enum(["media", "maxima"]),
  suporta_aquecimento: z.boolean(),
});

export const listArCondicionados = createServerFn({ method: "GET" }).handler(
  async (): Promise<ArCondicionado[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("ar_condicionados")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ArCondicionado[];
  },
);

export const salvarArCondicionado = createServerFn({ method: "POST" })
  .middleware([requireOperador])
  .inputValidator((data: z.infer<typeof arSchema> & { id?: string | null }) =>
    arSchema.extend({ id: z.string().uuid().nullable().optional() }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.setpoint_min >= data.setpoint_max) {
      throw new Error("setpoint_min deve ser menor que setpoint_max");
    }
    const { id, ...payload } = data;
    if (id) {
      const { error } = await supabaseAdmin
        .from("ar_condicionados")
        .update(payload as never)
        .eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true, id };
    }
    const { data: row, error } = await supabaseAdmin
      .from("ar_condicionados")
      .insert(payload as never)
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Falha ao criar");
    return { ok: true, id: (row as { id: string }).id };
  });

export const excluirArCondicionado = createServerFn({ method: "POST" })
  .middleware([requireOperador])
  .inputValidator((data: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("ar_condicionados")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Envia um comando IR manual para teste (liga ou desliga o ar imediatamente).
export const testarArCondicionado = createServerFn({ method: "POST" })
  .middleware([requireOperador])
  .inputValidator((data: { id: string; acao: "on" | "off"; modo?: "cool" | "heat" }) =>
    z.object({
      id: z.string().uuid(),
      acao: z.enum(["on", "off"]),
      modo: z.enum(["cool", "heat"]).optional(),
    }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ar, error } = await supabaseAdmin
      .from("ar_condicionados")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !ar) throw new Error(error?.message ?? "Ar não encontrado");
    const arRow = ar as unknown as ArCondicionado;
    if (!arRow.bancada_controladora_id) {
      throw new Error("Defina a prateleira controladora antes de testar");
    }
    const modo = data.modo ?? "cool";
    if (modo === "heat" && !arRow.suporta_aquecimento) {
      throw new Error("Este ar não está marcado como suporte a aquecimento");
    }
    const setpoint = data.acao === "on"
      ? (modo === "heat"
          ? Math.max(16, Math.min(30, Number(arRow.setpoint_max) - 1))
          : Math.max(16, Math.min(30, Number(arRow.setpoint_min) + 1)))
      : null;
    const raw = modo === "heat" ? arRow.codigo_ir_raw_heat : arRow.codigo_ir_raw;
    const { error: cmdErr } = await supabaseAdmin.from("comandos").insert({
      bancada_id: arRow.bancada_controladora_id,
      tipo: "AC_CONTROL",
      payload: {
        acao: data.acao,
        modo,
        setpoint,
        protocolo: arRow.ir_protocol,
        ar_id: arRow.id,
        teste: true,
        raw: raw ?? undefined,
      } as never,
    });
    if (cmdErr) throw new Error(cmdErr.message);
    await supabaseAdmin
      .from("ar_condicionados")
      .update({
        ligado: data.acao === "on",
        modo_atual: data.acao === "on" ? modo : "off",
        setpoint_atual: setpoint,
        ultimo_comando_em: new Date().toISOString(),
      })
      .eq("id", arRow.id);
    return { ok: true };
  });

// v2.2.0 — Coloca a bancada controladora em modo "aprender IR": ela liga o
// receptor VS1838B por `timeout_s` segundos e, ao capturar um frame do controle
// real, chama a RPC bench_ir_save_raw que grava em ar_condicionados.codigo_ir_raw.
export const aprenderIr = createServerFn({ method: "POST" })
  .middleware([requireOperador])
  .inputValidator((data: { id: string; timeout_s?: number; modo?: "cool" | "heat" }) =>
    z.object({
      id: z.string().uuid(),
      timeout_s: z.number().int().min(5).max(120).optional(),
      modo: z.enum(["cool", "heat"]).optional(),
    }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ar, error } = await supabaseAdmin
      .from("ar_condicionados")
      .select("id, bancada_controladora_id")
      .eq("id", data.id)
      .single();
    if (error || !ar) throw new Error(error?.message ?? "Ar não encontrado");
    const arRow = ar as { id: string; bancada_controladora_id: string | null };
    if (!arRow.bancada_controladora_id) {
      throw new Error("Defina a prateleira controladora antes de aprender IR");
    }
    const timeout_s = data.timeout_s ?? 30;
    const modo = data.modo ?? "cool";
    const { error: cmdErr } = await supabaseAdmin.from("comandos").insert({
      bancada_id: arRow.bancada_controladora_id,
      tipo: "IR_LEARN",
      payload: { ar_id: arRow.id, timeout_s, modo } as never,
    });
    if (cmdErr) throw new Error(cmdErr.message);
    return { ok: true, timeout_s };
  });
