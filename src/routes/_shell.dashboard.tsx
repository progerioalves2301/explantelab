import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Activity, Cpu, Droplets, Leaf } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { BancadaCard } from "@/components/bancada-card";
import { BancadaConfigDialog } from "@/components/bancada-config-dialog";
import { MOCK_BANCADAS } from "@/lib/mock-data";
import type { Bancada, Configuracoes } from "@/lib/types";

export const Route = createFileRoute("/_shell/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — GeneLab IoT" },
      {
        name: "description",
        content:
          "Visão geral em tempo real das bancadas ESP32, válvulas pneumáticas e ciclos de injeção.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const [bancadas, setBancadas] = useState<Bancada[]>(MOCK_BANCADAS);
  const [selected, setSelected] = useState<Bancada | null>(null);
  const [open, setOpen] = useState(false);

  // TODO(Supabase realtime): substituir MOCK_BANCADAS por
  //   useEffect(() => {
  //     const channel = supabase.channel('bancadas-live')
  //       .on('postgres_changes', { event: '*', schema: 'public', table: 'bancadas' },
  //         (payload) => setBancadas(prev => merge(prev, payload)))
  //       .subscribe()
  //     return () => { supabase.removeChannel(channel) }
  //   }, [])

  const stats = useMemo(() => {
    const active = bancadas.filter(
      (b) => b.status === "Injetando" || b.status === "Retornando",
    ).length;
    const offline = bancadas.filter((b) => b.status === "Offline").length;
    const idle = bancadas.filter((b) => b.status === "Repouso").length;
    return { total: bancadas.length, active, offline, idle };
  }, [bancadas]);

  const handleConfigure = (b: Bancada) => {
    setSelected(b);
    setOpen(true);
  };

  const handleSave = (id: number, config: Configuracoes) => {
    setBancadas((prev) =>
      prev.map((b) => (b.id === id ? { ...b, config } : b)),
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Monitoramento em tempo real dos 10 nós ESP32 do laboratório.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={<Cpu className="h-4 w-4" />}
          label="Bancadas"
          value={stats.total}
          tone="fluid"
        />
        <StatCard
          icon={<Droplets className="h-4 w-4" />}
          label="Em ciclo"
          value={stats.active}
          tone="leaf"
        />
        <StatCard
          icon={<Leaf className="h-4 w-4" />}
          label="Repouso"
          value={stats.idle}
          tone="idle"
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Offline"
          value={stats.offline}
          tone="destructive"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {bancadas.map((b) => (
          <BancadaCard key={b.id} bancada={b} onConfigure={handleConfigure} />
        ))}
      </div>

      <BancadaConfigDialog
        bancada={selected}
        open={open}
        onOpenChange={setOpen}
        onSave={handleSave}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
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
        <div
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${toneMap[tone]}`}
        >
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
