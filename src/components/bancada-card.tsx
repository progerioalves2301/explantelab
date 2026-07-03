import { Clock, Play, Settings2, Sprout, Timer, Trash2 } from "lucide-react";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "./status-badge";
import { ValveIndicator } from "./valve-indicator";
import { formatCountdown, timeAgo } from "@/lib/mock-data";
import { proximoDisparoSegundos } from "@/lib/schedule";
import { enviarComando, excluirBancada } from "@/lib/bancadas.functions";
import { toast } from "sonner";
import type { Bancada } from "@/lib/types";

interface Props {
  bancada: Bancada;
  onConfigure: (b: Bancada) => void;
}

export function BancadaCard({ bancada, onConfigure }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [testing, setTesting] = useState(false);
  const excluir = useServerFn(excluirBancada);
  const comandar = useServerFn(enviarComando);

  const mode =
    bancada.status === "Injetando"
      ? "injetando"
      : bancada.status === "Retornando"
        ? "retornando"
        : bancada.status === "Alivio"
          ? "alivio"
          : "idle";

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await excluir({ data: { id: bancada.id } });
      toast.success(`${bancada.nome} excluída`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir");
    } finally {
      setDeleting(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await comandar({
        data: { bancada_id: bancada.id, tipo: "FORCE_CYCLE" },
      });
      toast.success(`Ciclo de teste enviado para ${bancada.nome}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar teste");
    } finally {
      setTesting(false);
    }
  };


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
          <div className="col-span-2 flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-2 text-muted-foreground">
            <Sprout className="h-4 w-4 text-emerald-500" />
            <div className="flex-1">
              <div className="text-[10px] uppercase tracking-wide">
                Temperatura planta
              </div>
              <div className="font-mono text-sm text-foreground">
                {bancada.temperatura_planta != null
                  ? `${bancada.temperatura_planta.toFixed(1)} °C`
                  : "—"}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => onConfigure(bancada)}
          >
            <Settings2 className="mr-1.5 h-3.5 w-3.5" />
            Configurar
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleTest}
            disabled={testing}
            aria-label="Testar bancada (forçar ciclo)"
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            {testing ? "Enviando…" : "Testar"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={deleting}
                aria-label="Excluir bancada"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir {bancada.nome}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Isso remove a bancada, seu token e todos os comandos pendentes.
                  O ESP32 deixará de conseguir enviar telemetria. Ação irreversível.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

