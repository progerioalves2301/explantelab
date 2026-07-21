import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Activity, Cpu, Droplets, Leaf, Monitor, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BancadaCard } from "@/components/bancada-card";
import { BancadaConfigDialog } from "@/components/bancada-config-dialog";
import { supabase } from "@/integrations/supabase/client";
import type { Bancada, Laboratorio } from "@/lib/types";
import { withComputedBancadasStatus } from "@/lib/bancada-status";
import { buildSegments, type StatusSegment } from "@/components/status-timeline";
import { cn } from "@/lib/utils";

function sortLaboratorios(items: Laboratorio[]) {
  return items
    .slice()
    .sort(
      (a, b) =>
        a.ordem - b.ordem ||
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
}

function upsertLaboratorio(items: Laboratorio[], row: Laboratorio) {
  const idx = items.findIndex((l) => l.id === row.id);
  if (idx === -1) return sortLaboratorios([...items, row]);
  const copy = items.slice();
  copy[idx] = row;
  return sortLaboratorios(copy);
}

export const Route = createFileRoute("/_shell/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — GeneLab IoT" },
      {
        name: "description",
        content:
          "Monitoramento em tempo real das prateleiras ESP32, válvulas pneumáticas e ciclos de injeção.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const [bancadas, setBancadas] = useState<Bancada[]>([]);
  const [labs, setLabs] = useState<Laboratorio[]>([]);
  const [labFiltro, setLabFiltro] = useState<string | "todos" | "sem">("todos");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Bancada | null>(null);
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [logs, setLogs] = useState<
    { bancada_id: string; status: string; changed_at: string }[]
  >([]);
  const [mudasByBancada, setMudasByBancada] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    const refetch = async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [bRes, lRes, logRes, mRes] = await Promise.all([
        supabase
          .from("bancadas")
          .select("*")
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
        supabase
          .from("mudas")
          .select("bancada_id,identificador,created_at")
          .eq("ativa", true)
          .order("created_at", { ascending: false }),
      ]);
      if (!alive) return;
      setBancadas((bRes.data ?? []) as unknown as Bancada[]);
      setLabs((lRes.data ?? []) as unknown as Laboratorio[]);
      setLogs((logRes.data ?? []) as never);
      const map: Record<string, string> = {};
      for (const m of (mRes.data ?? []) as { bancada_id: string | null; identificador: string }[]) {
        if (m.bancada_id && !map[m.bancada_id]) map[m.bancada_id] = m.identificador;
      }
      setMudasByBancada(map);
      setLoading(false);
    };

    void refetch();

    const channel = supabase
      .channel("bancadas-live")
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
            if (idx === -1) return [...prev, row];
            const copy = prev.slice();
            copy[idx] = row;
            return copy;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "laboratorios" },
        (payload) => {
          setLabs((prev) => {
            if (payload.eventType === "DELETE") {
              const deletedId = (payload.old as Partial<Laboratorio>).id;
              if (!deletedId) {
                void refetch();
                return prev;
              }
              setLabFiltro((current) =>
                current === deletedId ? "todos" : current,
              );
              return prev.filter(
                (l) => l.id !== deletedId,
              );
            }
            const row = payload.new as unknown as Laboratorio;
            return upsertLaboratorio(prev, row);
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bancada_status_log" },
        (payload) => {
          const row = payload.new as {
            bancada_id: string;
            status: string;
            changed_at: string;
          };
          setLogs((prev) => [...prev, row]);
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

  // Polling de segurança para temperatura/status entre reconexões realtime.
  useEffect(() => {
    let alive = true;
    const timer = window.setInterval(async () => {
      const { data } = await supabase
        .from("bancadas")
        .select("*")
        .order("created_at", { ascending: true });
      if (!alive || !data) return;
      setBancadas(data as unknown as Bancada[]);
    }, 10_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (labFiltro === "todos" || labFiltro === "sem") return;
    if (!labs.some((lab) => lab.id === labFiltro)) setLabFiltro("todos");
  }, [labFiltro, labs]);

  const bancadasComStatus = useMemo(
    () => withComputedBancadasStatus(bancadas, clock),
    [bancadas, clock],
  );

  const segmentsByBancada = useMemo(() => {
    const map = new Map<string, StatusSegment[]>();
    for (const b of bancadasComStatus) {
      const bLogs = logs.filter((l) => l.bancada_id === b.id);
      map.set(b.id, buildSegments(bLogs, b.status, clock));
    }
    return map;
  }, [bancadasComStatus, logs, clock]);

  const filtradas = useMemo(() => {
    if (labFiltro === "todos") return bancadasComStatus;
    if (labFiltro === "sem")
      return bancadasComStatus.filter((b) => !b.laboratorio_id);
    return bancadasComStatus.filter((b) => b.laboratorio_id === labFiltro);
  }, [bancadasComStatus, labFiltro]);

  const stats = useMemo(() => {
    const active = filtradas.filter(
      (b) => b.status === "Injetando" || b.status === "Retornando",
    ).length;
    const offline = filtradas.filter((b) => b.status === "Offline").length;
    const idle = filtradas.filter((b) => b.status === "Repouso").length;
    return { total: filtradas.length, active, offline, idle };
  }, [filtradas]);

  const handleConfigure = (b: Bancada) => {
    setSelected(b);
    setOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Monitoramento em tempo real das prateleiras ESP32.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/tv">
              <Monitor className="mr-1.5 h-4 w-4" />
              Modo TV
            </Link>
          </Button>
          <Button asChild>
            <Link to="/bancadas/nova">
              <Plus className="mr-1.5 h-4 w-4" />
              Nova prateleira
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Cpu className="h-4 w-4" />} label="Prateleiras" value={stats.total} tone="fluid" />
        <StatCard icon={<Droplets className="h-4 w-4" />} label="Em ciclo" value={stats.active} tone="leaf" />
        <StatCard icon={<Leaf className="h-4 w-4" />} label="Repouso" value={stats.idle} tone="idle" />
        <StatCard icon={<Activity className="h-4 w-4" />} label="Offline" value={stats.offline} tone="destructive" />
      </div>


      {labs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <FiltroChip
            active={labFiltro === "todos"}
            onClick={() => setLabFiltro("todos")}
            label={`Todos (${bancadasComStatus.length})`}
          />
          {labs.map((lab) => {
            const count = bancadasComStatus.filter(
              (b) => b.laboratorio_id === lab.id,
            ).length;
            return (
              <FiltroChip
                key={lab.id}
                active={labFiltro === lab.id}
                onClick={() => setLabFiltro(lab.id)}
                label={`${lab.nome} (${count})`}
                color={lab.cor}
              />
            );
          })}
          {bancadasComStatus.some((b) => !b.laboratorio_id) && (
            <FiltroChip
              active={labFiltro === "sem"}
              onClick={() => setLabFiltro("sem")}
              label={`Sem sala bioreator (${bancadasComStatus.filter((b) => !b.laboratorio_id).length})`}
            />
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : filtradas.length === 0 ? (
        <Card className="card-elevated">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Cpu className="h-8 w-8 text-muted-foreground" />
            <div>
              <div className="font-semibold">
                {bancadasComStatus.length === 0
                  ? "Nenhuma prateleira cadastrada"
                  : "Nenhuma prateleira neste filtro"}
              </div>
              <p className="text-sm text-muted-foreground">
                {bancadasComStatus.length === 0
                  ? "Crie a primeira e receba o token para colar no portal AP do ESP32."
                  : "Selecione outro sala bioreator ou cadastre uma prateleira aqui."}
              </p>
            </div>
            <Button asChild size="sm">
              <Link to="/bancadas/nova">
                <Plus className="mr-1.5 h-4 w-4" />
                Nova prateleira
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtradas.map((b) => (
            <BancadaCard
              key={b.id}
              bancada={b}
              onConfigure={handleConfigure}
              segments={segmentsByBancada.get(b.id)}
              clock={clock}
              laboratorio={labs.find((l) => l.id === b.laboratorio_id) ?? null}
              variedade={mudasByBancada[b.id] ?? null}
            />
          ))}
        </div>

      )}

      <BancadaConfigDialog bancada={selected} open={open} onOpenChange={setOpen} laboratorios={labs} />
    </div>
  );
}

function StatCard({
  icon, label, value, tone,
}: {
  icon: React.ReactNode; label: string; value: number;
  tone: "leaf" | "fluid" | "idle" | "destructive";
}) {
  const toneMap: Record<typeof tone, string> = {
    leaf: "bg-leaf/15 text-leaf",
    fluid: "bg-fluid/15 text-fluid",
    idle: "bg-idle/15 text-idle",
    destructive: "bg-destructive/15 text-destructive",
  };
  return (
    <Card className="card-elevated">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${toneMap[tone]}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="text-xl font-bold tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function FiltroChip({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition sm:px-5 sm:py-2.5 sm:text-base",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      {color && (
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: color }}
        />
      )}

      {label}
    </button>
  );
}
