import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOperador, requireTecnico } from "@/lib/role-middleware";

export type Balanca = {
  id: string;
  nome: string;
  bancada_associada_id: string | null;
  paired_at: string | null;
  ativa: boolean;
  fator_calibracao: number;
  tara_g: number;
  ultima_leitura_g: number | null;
  ultima_sync: string | null;
  ultimo_ciclo_fim: string | null;
  minutos_estabilizacao: number;
  outlier_delta_g: number;
  residuo_ultimo_ciclo_g: number | null;
  created_at: string;
};

export const listarBalancas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("balancas")
      .select("id, nome, bancada_associada_id, ativa, fator_calibracao, tara_g, ultima_leitura_g, ultima_sync, ultimo_ciclo_fim, minutos_estabilizacao, outlier_delta_g, residuo_ultimo_ciclo_g, paired_at, created_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as Balanca[];
  });

const criarBalancaSchema = z.object({
  nome: z.string().min(2).max(60),
  bancada_associada_id: z.string().uuid().nullable().optional(),
  minutos_estabilizacao: z.number().int().min(0).max(60).optional(),
  outlier_delta_g: z.number().min(0.1).max(1000).optional(),
});

export const criarBalanca = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator((data: z.infer<typeof criarBalancaSchema>) => criarBalancaSchema.parse(data))
  .handler(async ({ data, context }) => {
    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    const deviceToken = btoa(String.fromCharCode(...raw))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const { data: row, error } = await context.supabase
      .from("balancas")
      .insert({
        nome: data.nome,
        bancada_associada_id: data.bancada_associada_id || null,
        device_token: deviceToken,
        minutos_estabilizacao: data.minutos_estabilizacao ?? 5,
        outlier_delta_g: data.outlier_delta_g ?? 10.0,
      } as any)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { balanca: row as unknown as Balanca };
  });


export const editarBalanca = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator(z.object({
    id: z.string().uuid(),
    nome: z.string().min(2).max(60).optional(),
    bancada_associada_id: z.string().uuid().nullable().optional(),
    ativa: z.boolean().optional(),
    minutos_estabilizacao: z.number().int().min(0).max(60).optional(),
    outlier_delta_g: z.number().min(0.1).max(1000).optional(),
    fator_calibracao: z.number().finite().min(-1000000).max(1000000)
      .refine((valor) => Math.abs(valor) >= 0.0001, "O fator não pode ser zero")
      .optional(),
    tara_g: z.number().optional(),
  }))
  .handler(async ({ data, context }) => {
    const { id, ...rest } = data;
    const patch = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(patch).length === 0) {
      const { data: atual, error: errAtual } = await context.supabase
        .from("balancas")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (errAtual) throw new Error(errAtual.message);
      if (!atual) throw new Error("Balança não encontrada");
      return atual as unknown as Balanca;
    }
    const { data: row, error } = await context.supabase
      .from("balancas")
      .update(patch as any)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Balança não encontrada ou sem permissão para editar");
    return row as unknown as Balanca;
  });


export const excluirBalanca = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("balancas")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const enviarComandoBalanca = createServerFn({ method: "POST" })
  .middleware([requireOperador])
  .inputValidator(z.object({
    balanca_id: z.string().uuid(),
    tipo: z.enum(["BALANCA_TARA", "BALANCA_CALIBRAR", "BALANCA_RESET"]),
    payload: z.record(z.string(), z.unknown()).optional(),
  }))
  .handler(async ({ data, context }) => {
    // 1. Busca o device_token da balança e a prateleira associada
    const { data: balanca, error: bErr } = await context.supabase
      .from("balancas")
      .select("device_token, bancada_associada_id")
      .eq("id", data.balanca_id)
      .single();
    if (bErr || !balanca) throw new Error("Balança não encontrada");

    // 2. Se tiver prateleira, manda comando para o ID da prateleira também
    // O comando é genérico, o ESP da balança escuta pelo device_token ou ID associado.
    const { error: cErr } = await context.supabase
      .from("comandos")
      .insert({
        bancada_id: balanca.bancada_associada_id as any,
        tipo: data.tipo,
        payload: {
          ...data.payload,
          device_token: balanca.device_token,
          balanca_id: data.balanca_id,
        } as any,
      });

    if (cErr) throw new Error(cErr.message);
    return { ok: true };
  });

export type PontoPeso = { minuto: string; valor_g: number };
export type PontoTemp = { minuto: string; valor: number };
export type FaseCiclo = { status: string; inicio: string; fim: string };

export type HistoricoPeso = {
  pontos: PontoPeso[];
  temperaturas: PontoTemp[];
  fases: FaseCiclo[];
  bancada_nome: string | null;
};

export const listarHistoricoPeso = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      balanca_id: z.string().uuid(),
      periodo: z.enum(["6h", "24h", "7d", "30d"]),
    }),
  )
  .handler(async ({ data, context }): Promise<HistoricoPeso> => {
    const horasPorPeriodo: Record<string, number> = {
      "6h": 6,
      "24h": 24,
      "7d": 24 * 7,
      "30d": 24 * 30,
    };
    const bucketPorPeriodo: Record<string, number> = {
      "6h": 1,
      "24h": 2,
      "7d": 15,
      "30d": 60,
    };
    const horas = horasPorPeriodo[data.periodo] ?? 24;
    const bucketMin = bucketPorPeriodo[data.periodo] ?? 1;
    const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString();

    // 1. Histórico de peso (paginado para vencer o teto de 1000 linhas)
    const brutos: PontoPeso[] = [];
    const pageSize = 1000;
    for (let i = 0; i < 60; i++) {
      const { data: rows, error } = await context.supabase
        .from("medicoes_balanca")
        .select("minuto, valor_g")
        .eq("balanca_id", data.balanca_id)
        .gte("minuto", desde)
        .order("minuto", { ascending: true })
        .range(i * pageSize, (i + 1) * pageSize - 1);
      if (error) throw new Error(error.message);
      const batch = rows ?? [];
      for (const r of batch) {
        brutos.push({ minuto: r.minuto as string, valor_g: Number(r.valor_g) });
      }
      if (batch.length < pageSize) break;
    }

    const agregar = <T extends { minuto: string }>(
      lista: T[],
      pegar: (t: T) => number,
    ) => {
      if (bucketMin <= 1) {
        return lista.map((p) => ({ minuto: p.minuto, valor: pegar(p) }));
      }
      const bucketMs = bucketMin * 60_000;
      const buckets = new Map<number, { soma: number; n: number }>();
      for (const p of lista) {
        const key =
          Math.floor(new Date(p.minuto).getTime() / bucketMs) * bucketMs;
        const cur = buckets.get(key) ?? { soma: 0, n: 0 };
        cur.soma += pegar(p);
        cur.n += 1;
        buckets.set(key, cur);
      }
      return Array.from(buckets.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([k, v]) => ({
          minuto: new Date(k).toISOString(),
          valor: v.soma / v.n,
        }));
    };

    const pontos: PontoPeso[] = agregar(brutos, (p) => p.valor_g).map((p) => ({
      minuto: p.minuto,
      valor_g: p.valor,
    }));

    // 2. Prateleira associada — temperatura e fases do ciclo
    const { data: balanca, error: errB } = await context.supabase
      .from("balancas")
      .select("bancada_associada_id")
      .eq("id", data.balanca_id)
      .maybeSingle();
    if (errB) throw new Error(errB.message);

    const bancadaId = balanca?.bancada_associada_id ?? null;
    if (!bancadaId) {
      return { pontos, temperaturas: [], fases: [], bancada_nome: null };
    }

    const { data: bancada } = await context.supabase
      .from("bancadas")
      .select("nome")
      .eq("id", bancadaId)
      .maybeSingle();

    const tempBrutas: { minuto: string; valor: number }[] = [];
    for (let i = 0; i < 60; i++) {
      const { data: rows, error } = await context.supabase
        .from("medicoes_temperatura")
        .select("minuto, valor")
        .eq("bancada_id", bancadaId)
        .gte("minuto", desde)
        .gt("valor", -10)
        .lt("valor", 85)
        .order("minuto", { ascending: true })
        .range(i * pageSize, (i + 1) * pageSize - 1);
      if (error) break;
      const batch = rows ?? [];
      for (const r of batch) {
        tempBrutas.push({ minuto: r.minuto as string, valor: Number(r.valor) });
      }
      if (batch.length < pageSize) break;
    }
    const temperaturas: PontoTemp[] = agregar(tempBrutas, (p) => p.valor);

    // 3. Fases do ciclo hidráulico a partir do log de status
    const { data: logs } = await context.supabase
      .from("bancada_status_log")
      .select("status, changed_at")
      .eq("bancada_id", bancadaId)
      .gte("changed_at", desde)
      .order("changed_at", { ascending: true });

    const fases: FaseCiclo[] = [];
    const ativos = new Set(["Injetando", "Pausado", "Retornando", "Alivio"]);
    const lista = logs ?? [];
    for (let i = 0; i < lista.length; i++) {
      const atual = lista[i]!;
      if (!ativos.has(atual.status as string)) continue;
      const fim = lista[i + 1]?.changed_at ?? new Date().toISOString();
      fases.push({
        status: atual.status as string,
        inicio: atual.changed_at as string,
        fim: fim as string,
      });
    }

    return {
      pontos,
      temperaturas,
      fases,
      bancada_nome: (bancada?.nome as string | undefined) ?? null,
    };
  });
