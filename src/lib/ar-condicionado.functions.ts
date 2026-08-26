import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTecnico } from "@/lib/role-middleware";

export interface ArCondicionado {
  id: string;
  laboratorio_id: string;
  bancada_controladora_id: string | null;
  marca: string;
  modelo: string | null;
  ir_protocol: string;
  ativo: boolean;
  histerese: number;
  intervalo_min_comando_s: number;
  /** Tempo mínimo que o ar permanece no estado atual antes de comutar (s). */
  permanencia_min_s: number;
  agregacao: "media" | "maxima" | "controladora";
  ligado: boolean;
  modo_atual: "off" | "cool" | "heat";
  setpoint_atual: number | null;
  ultimo_comando_em: string | null;
  ultimo_temp_lida: number | null;
  codigo_ir_raw: number[] | null;
  codigo_ir_raw_heat: number[] | null;
  /** Código IR aprendido do botão DESLIGAR do controle original */
  codigo_ir_raw_off: number[] | null;
  suporta_aquecimento: boolean;
  ir_learn_debug: { evento: string; pulsos: number; extra?: Record<string, string | number | boolean | null>; em: string } | null;
  created_at: string;
  updated_at: string;
}

export interface DecisaoAr {
  id: number;
  criado_em: string;
  temperatura_ref: number | null;
  origem: string | null;
  temp_min: number | null;
  temp_max: number | null;
  histerese: number | null;
  estado_atual: string | null;
  decisao: string | null;
  motivo: string;
  comando_enviado: boolean;
}

export interface DiagnosticoAr {
  ultimo_comando: {
    created_at: string;
    entregue_em: string | null;
    acao: string | null;
    modo: string | null;
  } | null;
  temp_no_comando: number | null;
  temp_atual: number | null;
  decisoes: DecisaoAr[];
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
  histerese: z.number().min(0.1).max(5),
  intervalo_min_comando_s: z.number().int().min(30).max(3600),
  permanencia_min_s: z.number().int().min(60).max(7200),
  agregacao: z.enum(["media", "maxima", "controladora"]),
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
  .middleware([requireTecnico])
  .inputValidator((data: z.infer<typeof arSchema> & { id?: string | null }) =>
    arSchema.extend({ id: z.string().uuid().nullable().optional() }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
  .middleware([requireTecnico])
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
  .middleware([requireTecnico])
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
    // Alvo = limite que dispara, lido da faixa de alerta da prateleira
    // controladora (única fonte de faixa). Como o comando é IR RAW aprendido,
    // esse valor é só informativo pra UI — o replay envia o código capturado.
    const { data: ctrl } = await supabaseAdmin
      .from("bancadas")
      .select("temp_min, temp_max")
      .eq("id", arRow.bancada_controladora_id)
      .single();
    const faixa = (ctrl ?? {}) as { temp_min: number | null; temp_max: number | null };
    const setpoint = data.acao === "on"
      ? (modo === "heat" ? faixa.temp_min : faixa.temp_max)
      : null;

    // Cada estado tem seu próprio código IR aprendido. Muitos aparelhos
    // (Fujitsu, Consul…) usam frames diferentes pra ligar e desligar — se
    // reenviarmos o código de LIGAR no OFF, o ar liga mas nunca desliga.
    const raw = data.acao === "off"
      ? arRow.codigo_ir_raw_off
      : (modo === "heat" ? arRow.codigo_ir_raw_heat : arRow.codigo_ir_raw);
    if (data.acao === "off" && arRow.ir_protocol === "RAW" && !raw) {
      throw new Error(
        "Nenhum código IR de DESLIGAR aprendido. Use \"IR desligar\" e aperte o botão de desligar do controle original.",
      );
    }
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
  .middleware([requireTecnico])
  .inputValidator((data: { id: string; timeout_s?: number; modo?: "cool" | "heat" | "off" }) =>
    z.object({
      id: z.string().uuid(),
      timeout_s: z.number().int().min(5).max(120).optional(),
      modo: z.enum(["cool", "heat", "off"]).optional(),
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

// Reenvia o último estado desejado (liga/desliga) para o aparelho. Útil quando
// o banco acredita que o ar está ligado mas o aparelho está desligado — por
// exemplo depois de testes manuais ou de uma queda de energia.
export const ressincronizarArCondicionado = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator((data: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(data),
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
      throw new Error("Defina a prateleira controladora antes de ressincronizar");
    }

    const acao = arRow.ligado ? "on" : "off";
    const modo = arRow.ligado ? (arRow.modo_atual === "heat" ? "heat" : "cool") : "off";
    const raw = !arRow.ligado
      ? arRow.codigo_ir_raw_off
      : modo === "heat"
        ? arRow.codigo_ir_raw_heat
        : arRow.codigo_ir_raw;
    if (arRow.ir_protocol === "RAW" && !raw) {
      throw new Error(
        acao === "off"
          ? "Nenhum código IR de DESLIGAR aprendido."
          : "Nenhum código IR de LIGAR aprendido.",
      );
    }

    // Não empilha: descarta comandos de AC ainda não entregues.
    await supabaseAdmin
      .from("comandos")
      .delete()
      .eq("bancada_id", arRow.bancada_controladora_id)
      .eq("tipo", "AC_CONTROL")
      .is("entregue_em", null);

    const { error: cmdErr } = await supabaseAdmin.from("comandos").insert({
      bancada_id: arRow.bancada_controladora_id,
      tipo: "AC_CONTROL",
      payload: {
        acao,
        modo: modo === "off" ? "cool" : modo,
        setpoint: arRow.setpoint_atual,
        protocolo: arRow.ir_protocol,
        ar_id: arRow.id,
        raw: raw ?? undefined,
      } as never,
    });
    if (cmdErr) throw new Error(cmdErr.message);

    await supabaseAdmin
      .from("ar_condicionados")
      .update({ ultimo_comando_em: new Date().toISOString() })
      .eq("id", arRow.id);

    return { ok: true, acao };
  });
