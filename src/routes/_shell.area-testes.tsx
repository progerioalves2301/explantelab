import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Activity, Cpu, Droplets, FlaskConical, Monitor, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BancadaCard } from "@/components/bancada-card";
import { BancadaConfigDialog } from "@/components/bancada-config-dialog";
import { supabase } from "@/integrations/supabase/client";
import type { Bancada, Laboratorio } from "@/lib/types";
import { withComputedBancadasStatus } from "@/lib/bancada-status";
import { buildSegments, type StatusSegment } from "@/components/status-timeline";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/area-testes")({
  head: () => ({
    meta: [
      { title: "Área de Testes — VitroCeres" },
      {
        name: "description",
        content: "Espaço restrito para teste de novos equipamentos.",
      },
    ],
  }),
  component: AreaTestesPage,
});

function AreaTestesPage() {
  const [bancadas, setBancadas] = useState<Bancada[]>([]);
  const [labs, setLabs] = useState<Laboratorio[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Bancada | null>(null);
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [logs, setLogs] = useState<{ bancada_id: string; status: string; changed_at: string }[]>([]);
  const [co2ByLab, setCo2ByLab] = useState<Record<string, number>>({});

  // CO₂ por sala (sensores independentes enviam para sensores_co2)
  useEffect(() => {
    let alive = true;
    const carregarCo2 = async () => {
      const { data } = await supabase
        .from("sensores_co2")
        .select("laboratorio_id, ultima_leitura_ppm, ultima_medicao_em")
        .eq("ativo", true)
        .order("ultima_medicao_em", { ascending: false, nullsFirst: false });
      if (!alive || !data) return;
      const map: Record<string, number> = {};
      for (const r of data as {
        laboratorio_id: string;
        ultima_leitura_ppm: number | null;
      }[]) {
        if (r.ultima_leitura_ppm == null) continue;
        if (map[r.laboratorio_id] == null)
          map[r.laboratorio_id] = Number(r.ultima_leitura_ppm);
      }
      setCo2ByLab(map);
    };
    void carregarCo2();
    const id = setInterval(() => void carregarCo2(), 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);



  useEffect(() => {
    let alive = true;
    const refetch = async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [bRes, lRes, logRes] = await Promise.all([
        supabase
          .from("bancadas")
          .select("*")
          .eq("is_teste", true)
          .order("created_at", { ascending: true }),
        supabase
          .from("laboratorios")
          .select("*")
          .order("ordem", { ascending: true }),
        supabase
          .from("bancada_status_log")
          .select("bancada_id,status,changed_at")
          .gte("changed_at", since)
          .order("changed_at", { ascending: true }),
      ]);
      if (!alive) return;
      setBancadas((bRes.data ?? []) as unknown as Bancada[]);
      setLabs((lRes.data ?? []) as unknown as Laboratorio[]);
      setLogs((logRes.data ?? []) as any);
      setLoading(false);
    };

    void refetch();

    const channel = supabase
      .channel("bancadas-test-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bancadas" },
        (payload) => {
          setBancadas((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((b) => b.id !== (payload.old as Bancada).id);
            }
            const row = payload.new as unknown as Bancada;

            const idx = prev.findIndex((b) => b.id === row.id);
            if (idx === -1) {
              // Se é novo e é teste, adiciona
              if (row.is_teste) return [...prev, row];
              return prev;
            }

            // Se já existia mas agora não é mais teste, remove
            if (!row.is_teste) {
              return prev.filter((b) => b.id !== row.id);
            }

            const copy = prev.slice();
            copy[idx] = row;
            return copy;
          });
        },
      )
      .subscribe();

    const timer = window.setInterval(refetch, 10_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const bancadasComStatus = useMemo(() => withComputedBancadasStatus(bancadas, clock), [bancadas, clock]);

  const segmentsByBancada = useMemo(() => {
    const map = new Map<string, StatusSegment[]>();
    for (const b of bancadasComStatus) {
      const bLogs = logs.filter((l) => l.bancada_id === b.id);
      map.set(b.id, buildSegments(bLogs, b.status, clock));
    }
    return map;
  }, [bancadasComStatus, logs, clock]);

  const handleConfigure = (b: Bancada) => {
    setSelected(b);
    setOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Área de Testes</h1>
          <p className="text-sm text-muted-foreground">
            Equipamentos em fase de validação (visíveis apenas para administradores).
          </p>
        </div>
        <Button asChild>
          <Link to="/bancadas/nova">
            <Plus className="mr-1.5 h-4 w-4" />
            Novo equipamento teste
          </Link>
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : bancadasComStatus.length === 0 ? (
        <Card className="card-elevated border-dashed border-primary/30">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <FlaskConical className="h-10 w-10 text-muted-foreground/50" />
            <div>
              <div className="font-semibold text-lg">Nenhum equipamento em teste</div>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Marque uma prateleira como "Equipamento de Teste" nas configurações para que ela apareça nesta área restrita.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {bancadasComStatus.map((b) => (
            <div key={b.id} className="relative group">
              <div className="absolute -top-2 -right-2 z-10 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground shadow-sm ring-2 ring-background uppercase tracking-wider">
                Teste
              </div>
              <BancadaCard
                bancada={b}
                onConfigure={handleConfigure}
                segments={segmentsByBancada.get(b.id)}
                clock={clock}
                laboratorio={labs.find((l) => l.id === b.laboratorio_id) ?? null}
                co2Ppm={b.laboratorio_id ? (co2ByLab[b.laboratorio_id] ?? null) : null}
              />

            </div>
          ))}
        </div>
      )}

      <BancadaConfigDialog bancada={selected} open={open} onOpenChange={setOpen} laboratorios={labs} />
    </div>
  );
}
