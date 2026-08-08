import { createServerFn } from "@tanstack/react-start";
import { requireTecnico } from "@/lib/role-middleware";

export const fixOfflineThresholds = createServerFn({ method: "POST" })
  .middleware([requireTecnico])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("bancadas")
      .update({ offline_threshold_segundos: 420 })
      .eq("offline_threshold_segundos", 300)
      .select("id");
    
    if (error) throw new Error(error.message);
    return { ok: true, updated: data?.length ?? 0 };
  });
