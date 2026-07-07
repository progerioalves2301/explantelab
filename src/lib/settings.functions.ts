import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Configuracoes } from "./types";
import { DEFAULT_CONFIG } from "./types";

const HORARIO_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const configSchema = z.object({
  tempo_injecao_segundos: z.number().int().min(1).max(3600),
  tempo_pausa_segundos: z.number().int().min(0).max(3600),
  tempo_retorno_segundos: z.number().int().min(1).max(3600),
  tempo_alivio_segundos: z.number().int().min(0).max(600),
  horarios_disparo: z
    .array(z.string().regex(HORARIO_REGEX, "Formato HH:MM"))
    .min(1, "Ao menos 1 horário")
    .max(24, "Máximo 24 horários"),
  luz_ligar: z.string().regex(HORARIO_REGEX, "Formato HH:MM"),
  luz_desligar: z.string().regex(HORARIO_REGEX, "Formato HH:MM"),
});

const DEFAULT_KEY = "default_ciclo";

export const getDefaultCiclo = createServerFn({ method: "GET" }).handler(
  async (): Promise<Configuracoes> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", DEFAULT_KEY)
      .maybeSingle();
    if (!data) return DEFAULT_CONFIG;
    const parsed = configSchema.safeParse(data.value);
    return parsed.success ? parsed.data : DEFAULT_CONFIG;
  },
);

export const salvarDefaultCiclo = createServerFn({ method: "POST" })
  .inputValidator((data: { config: Configuracoes }) =>
    z.object({ config: configSchema }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({
        key: DEFAULT_KEY,
        value: data.config as never,
        updated_at: new Date().toISOString(),
      });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
