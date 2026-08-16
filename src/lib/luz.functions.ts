import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type IntervaloLuz = {
  ligada: boolean;
  inicio: string; // ISO
  fim: string;    // ISO
};

export const listarHistoricoLuz = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { bancada_id: string; desde: string }) => input
  )
  .handler(async ({ data, context }) => {
    const { data: intervals, error } = await context.supabase.rpc(
      "listar_historico_luz",
      {
        _bancada_id: data.bancada_id,
        _desde: data.desde,
      }
    );

    if (error) {
      console.error("Erro ao listar histórico de luz:", error);
      return [] as IntervaloLuz[];
    }

    return (intervals || []) as IntervaloLuz[];
  });
