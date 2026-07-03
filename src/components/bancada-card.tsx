import {
  ArrowLeft,
  Clock,
  FlaskConical,
  Leaf,
  Settings2,
  SlidersHorizontal,
  Sprout,
  Square,
  Timer,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import type { Bancada, ValvulasEstado } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  bancada: Bancada;
  onConfigure: (b: Bancada) => void;
}

// Presets dos botões Bio Reator (V1..V5)
const PRESET_PLANTA: ValvulasEstado = {
  v1: true,
  v2: false,
  v3: false,
  v4: true,
  v5: false,
};
const PRESET_MEIO: ValvulasEstado = {
  v1: false,
  v2: true,
  v3: true,
  v4: false,
  v5: false,
};

function eq(a: ValvulasEstado, b: ValvulasEstado) {
  return (
    a.v1 === b.v1 &&
    a.v2 === b.v2 &&
    a.v3 === b.v3 &&
    a.v4 === b.v4 &&
    a.v5 === b.v5
  );
}

export function BancadaCard({ bancada, onConfigure }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<"status" | "manual">("status");
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

  const valvulas = bancada.valvulas;
  const isPlanta = eq(valvulas, PRESET_PLANTA);
  const isMeio = eq(valvulas, PRESET_MEIO);

  const sendValves = async (v: ValvulasEstado, label: string) => {
    setSending(true);
    try {
      await comandar({
        data: {
          bancada_id: bancada.id,
          tipo: "SET_VALVE",
          payload: v as unknown as Record<string, unknown>,
        },
      });
      toast.success(`${label} enviado`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar comando");
    } finally {
      setSending(false);
    }
  };


  const sendPause = async (label: string) => {
    setSending(true);
    try {
      await comandar({
        data: { bancada_id: bancada.id, tipo: "PAUSE" },
      });
      toast.success(label);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao pausar");
    } finally {
      setSending(false);
    }
  };

  const togglePlanta = () =>
    isPlanta
      ? sendPause("Bio Reator Planta pausado — repouso")
      : sendValves(PRESET_PLANTA, "Bio Reator Planta ligado");

  const toggleMeio = () =>
    isMeio
      ? sendPause("Bio Reator Meio pausado — repouso")
      : sendValves(PRESET_MEIO, "Bio Reator Meio ligado");

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

  const handleStop = async () => {
    setStopping(true);
    try {
      await comandar({
        data: { bancada_id: bancada.id, tipo: "PAUSE" },
      });
      toast.success(`Bancada ${bancada.nome} parada`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao parar bancada");
    } finally {
      setStopping(false);
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
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "status" | "manual")}
          className="w-full"
        >
          <TabsList className="sr-only">
            <TabsTrigger value="status">Status</TabsTrigger>
            <TabsTrigger value="manual">Manual</TabsTrigger>
          </TabsList>

          <TabsContent value="status" className="mt-3 space-y-4">
            <div className="rounded-lg border bg-muted/40 p-3">
              <ValveIndicator valvulas={valvulas} mode={mode} />
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Timer className="h-3.5 w-3.5 text-primary" />
                <div>
                  <div className="text-[10px] uppercase tracking-wide">
                    Próximo ciclo
                  </div>
                  <div className="font-mono text-sm text-foreground">
                    {(() => {
                      const s = proximoDisparoSegundos(
                        bancada.config?.horarios_disparo,
                      );
                      return s == null ? "—" : formatCountdown(s);
                    })()}
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
          </TabsContent>

          <TabsContent value="manual" className="mt-3 space-y-4">

            <div
              className={cn(
                "flex items-center gap-3 rounded-md border px-3 py-2 text-xs font-medium transition-colors",
                isPlanta &&
                  "border-emerald-500/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                isMeio &&
                  "border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-400",
                !isPlanta &&
                  !isMeio &&
                  "border-dashed text-muted-foreground",
              )}
              aria-live="polite"
              aria-label={
                isPlanta
                  ? "Fluxo do Meio para a Planta"
                  : isMeio
                    ? "Fluxo da Planta para o Meio"
                    : "Sem fluxo ativo"
              }
            >
              <span className="flex shrink-0 items-center gap-1.5">
                <FlaskConical className="h-3.5 w-3.5" />
                Meio
              </span>

              <div
                className={cn("flow-track", isMeio && "flow-track-reverse")}
              >
                {(isPlanta || isMeio) && (
                  <>
                    <span className="flow-drop" style={{ animationDelay: "0s" }} />
                    <span className="flow-drop" style={{ animationDelay: "0.22s" }} />
                    <span className="flow-drop" style={{ animationDelay: "0.45s" }} />
                    <span className="flow-drop" style={{ animationDelay: "0.67s" }} />
                  </>
                )}
              </div>

              <span className="flex shrink-0 items-center gap-1.5">
                <Leaf className="h-3.5 w-3.5" />
                Planta
              </span>
            </div>


            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                onClick={togglePlanta}
                disabled={sending}
                className={
                  isPlanta
                    ? "bg-emerald-700 text-white hover:bg-emerald-800"
                    : "bg-emerald-200 text-emerald-900 hover:bg-emerald-300 border-emerald-300"
                }
                variant={isPlanta ? "default" : "outline"}
              >
                <Leaf className="mr-1.5 h-3.5 w-3.5" />
                Bio Reator Planta
              </Button>
              <Button
                size="sm"
                onClick={toggleMeio}
                disabled={sending}
                className={
                  isMeio
                    ? "bg-sky-700 text-white hover:bg-sky-800"
                    : "bg-sky-200 text-sky-900 hover:bg-sky-300 border-sky-300"
                }
                variant={isMeio ? "default" : "outline"}
              >
                <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
                Bio Reator Meio
              </Button>
            </div>

            <p className="text-[11px] text-muted-foreground">
              O modo manual pausa o ciclo automático. Para retomar o
              agendamento, clique em <span className="font-semibold">STOP</span>{" "}
              e aguarde o próximo horário.
            </p>
          </TabsContent>
        </Tabs>

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
          {tab === "manual" ? (
            <Button
              size="sm"
              onClick={() => setTab("status")}
              variant="outline"
              aria-label="Voltar para Status"
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Sair
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => setTab("manual")}
              className="bg-blue-600 text-white hover:bg-blue-700"
              aria-label="Abrir modo manual"
            >
              <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
              Manual
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleStop}
            disabled={stopping}
            className="bg-red-600 text-white hover:bg-red-700"
            aria-label="Parar bancada"
          >
            <Square className="mr-1.5 h-3.5 w-3.5 fill-current" />
            {stopping ? "Enviando…" : "STOP"}
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
                  Isso remove a bancada, seu token e todos os comandos
                  pendentes. O ESP32 deixará de conseguir enviar telemetria.
                  Ação irreversível.
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
