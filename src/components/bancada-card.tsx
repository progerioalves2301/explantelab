import { Clock, Settings2, Timer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./status-badge";
import { ValveIndicator } from "./valve-indicator";
import { formatCountdown, timeAgo } from "@/lib/mock-data";
import type { Bancada } from "@/lib/types";

interface Props {
  bancada: Bancada;
  onConfigure: (b: Bancada) => void;
}

export function BancadaCard({ bancada, onConfigure }: Props) {
  const mode =
    bancada.status === "Injetando"
      ? "injetando"
      : bancada.status === "Retornando"
        ? "retornando"
        : bancada.status === "Alivio"
          ? "alivio"
          : "idle";

  return (
    <Card className="card-elevated overflow-hidden transition hover:border-primary/40">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="truncate text-base font-semibold">
            {bancada.nome}
          </CardTitle>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            NODE-ESP32-{String(bancada.id).padStart(3, "0")}
          </p>
        </div>
        <StatusBadge status={bancada.status} />
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/40 p-3">
          <ValveIndicator valvulas={bancada.valvulas} mode={mode} />
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Timer className="h-3.5 w-3.5 text-primary" />
            <div>
              <div className="text-[10px] uppercase tracking-wide">
                Próximo ciclo
              </div>
              <div className="font-mono text-sm text-foreground">
                {formatCountdown(bancada.proximo_ciclo_segundos)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-3.5 w-3.5 text-fluid" />
            <div>
              <div className="text-[10px] uppercase tracking-wide">
                Última sync
              </div>
              <div className="font-mono text-sm text-foreground">
                {timeAgo(bancada.ultima_sync)}
              </div>
            </div>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onConfigure(bancada)}
        >
          <Settings2 className="mr-1.5 h-3.5 w-3.5" />
          Configurar
        </Button>
      </CardContent>
    </Card>
  );
}
