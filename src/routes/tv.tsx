import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Activity, Cpu, Droplets, Leaf } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Bancada, BancadaStatus } from "@/lib/types";
import { withComputedBancadasStatus } from "@/lib/bancada-status";
import { formatShortDuration, tempoNoEstado } from "@/lib/duration";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tv")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Modo TV — GeneLab IoT" },
      {
        name: "description",
        content: "Painel fullscreen das bancadas para exibição em TV/monitor de parede.",
      },
    ],
  }),
  component: TvPage,
});

const bgFor: Record<BancadaStatus, string> = {
  Injetando: "bg-leaf text-leaf-foreground",
  Retornando: "bg-fluid text-fluid-foreground",
  Alivio: "bg-warn text-warn-foreground",
  Repouso: "bg-idle text-idle-foreground",
  Pausado: "bg-warn text-warn-foreground",
  Manual: "bg-primary text-primary-foreground",
  Offline: "bg-destructive text-destructive-foreground",
};

function TvPage() {
  const [bancadas, setBancadas] = useState<Bancada[]>([]);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("bancadas")
        .select("*")
        .order("posicao", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });
      if (!alive) return;
      setBancadas((data ?? []) as unknown as Bancada[]);
    })();

    const channel = supabase
      .channel("tv-bancadas-live")
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
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setClock(Date.now()), 10_000);
    return () => window.clearInterval(t);
  }, []);

  const items = useMemo(
    () => withComputedBancadasStatus(bancadas, clock),
    [bancadas, clock],
  );

  const stats = useMemo(() => {
    const active = items.filter(
      (b) => b.status === "Injetando" || b.status === "Retornando",
    ).length;
    const offline = items.filter((b) => b.status === "Offline").length;
    const idle = items.filter((b) => b.status === "Repouso").length;
    return { total: items.length, active, offline, idle };
  }, [items]);

  // Escolhe grid conforme quantidade de bancadas para preencher a tela.
  const cols =
    items.length <= 4
      ? "grid-cols-2"
      : items.length <= 9
        ? "grid-cols-3"
        : items.length <= 16
          ? "grid-cols-4"
          : "grid-cols-5";

  const now = new Date(clock);
  const hora = now.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 border-b bg-card/60 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Sair
          </Link>
          <h1 className="text-lg font-bold tracking-tight">Painel Bancadas</h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Chip icon={<Cpu className="h-3.5 w-3.5" />} label="Total" value={stats.total} />
          <Chip icon={<Droplets className="h-3.5 w-3.5 text-leaf" />} label="Em ciclo" value={stats.active} />
          <Chip icon={<Leaf className="h-3.5 w-3.5 text-idle" />} label="Repouso" value={stats.idle} />
          <Chip
            icon={<Activity className="h-3.5 w-3.5 text-destructive" />}
            label="Offline"
            value={stats.offline}
          />
          <div className="tabular-nums text-xl font-bold">{hora}</div>
        </div>
      </header>

      <main className="p-4">
        {items.length === 0 ? (
          <p className="p-10 text-center text-muted-foreground">
            Nenhuma bancada cadastrada.
          </p>
        ) : (
          <div className={cn("grid gap-3", cols)}>
            {items.map((b) => (
              <TvCard key={b.id} bancada={b} clock={clock} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function TvCard({ bancada, clock }: { bancada: Bancada; clock: number }) {
  const pulse =
    bancada.status === "Injetando" || bancada.status === "Retornando";
  return (
    <div
      className={cn(
        "flex flex-col justify-between rounded-2xl p-5 shadow-lg transition",
        bgFor[bancada.status],
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-2xl font-black leading-tight">
            {bancada.nome}
          </div>
          <div className="text-xs opacity-80">
            {bancada.temperatura_planta != null
              ? `${bancada.temperatura_planta.toFixed(1)} °C`
              : "— °C"}
          </div>
        </div>
        <span
          className={cn(
            "h-3 w-3 shrink-0 rounded-full bg-current",
            pulse && "animate-pulse",
          )}
        />
      </div>
      <div className="mt-4">
        <div className="text-3xl font-black uppercase tracking-tight">
          {bancada.status}
        </div>
        <div className="mt-1 text-sm font-medium opacity-90 tabular-nums">
          há {formatShortDuration(tempoNoEstado(bancada, clock))}
        </div>
      </div>
    </div>
  );
}

function Chip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border bg-background/70 px-3 py-1">
      {icon}
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  );
}
