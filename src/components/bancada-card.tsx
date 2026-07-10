import {
  ArrowLeft,
  AlertTriangle,
  Clock,
  Copy,
  FlaskConical,
  KeyRound,
  Leaf,
  Lightbulb,
  Settings2,
  Clock3,
  SlidersHorizontal,
  Sprout,
  Square,
  Timer,
  Trash2,
} from "lucide-react";

import { useEffect, useState } from "react";
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
import { enviarComando, excluirBancada, regenerarPairingCode } from "@/lib/bancadas.functions";
import { toast } from "sonner";
import type { Bancada, Laboratorio, ValvulasEstado } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatShortDuration, tempoNoEstado } from "@/lib/duration";
import { StatusTimeline, type StatusSegment } from "./status-timeline";

interface Props {
  bancada: Bancada;
  onConfigure: (b: Bancada) => void;
  segments?: StatusSegment[];
  clock?: number;
  laboratorio?: Laboratorio | null;
}


// Presets dos botões Bio Reator (V1..V4 — V5 removida do projeto, sempre false)
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

export function BancadaCard({ bancada, onConfigure, segments, clock, laboratorio }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<"status" | "manual">("status");
  const [pairOpen, setPairOpen] = useState(false);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const excluir = useServerFn(excluirBancada);
  const comandar = useServerFn(enviarComando);
  const gerarCodigo = useServerFn(regenerarPairingCode);
  const sensorReinicios = bancada.sensor_reinicios ?? 0;
  const temTemperatura = bancada.temperatura_planta != null;
  const sensorComFalha = !temTemperatura;
  const sensorComAviso = temTemperatura && Boolean(bancada.sensor_travado);
  const textoTemperaturaIndisponivel = "Sem temperatura recebida";

  const abrirPareamento = async () => {
    setPairOpen(true);
    setPairCode(null);
    setPairing(true);
    try {
      const r = await gerarCodigo({ data: { bancada_id: bancada.id } });
      setPairCode(r.pairing_code);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar código");
      setPairOpen(false);
    } finally {
      setPairing(false);
    }
  };

  const copiarCodigo = async () => {
    if (!pairCode) return;
    try {
      await navigator.clipboard.writeText(pairCode);
      toast.success("Código copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };


  const mode =
    bancada.status === "Injetando"
      ? "injetando"
      : bancada.status === "Retornando"
        ? "retornando"
        : "idle";


  // ----- Estado otimista das válvulas -----
  // Assim que o usuário clica, a UI já reflete o preset sem esperar o
  // round-trip ESP32 → banco → realtime (2–7 s). O otimista só é descartado
  // quando a telemetria real bate com ele (ESP32 confirmou o comando) ou
  // após um timeout de segurança (10 s), evitando "pisca" quando a telemetria
  // chega antes do ESP aplicar o PAUSE/SET_VALVE.
  const [optimistic, setOptimistic] = useState<ValvulasEstado | null>(null);
  useEffect(() => {
    if (optimistic && eq(optimistic, bancada.valvulas)) {
      setOptimistic(null);
    }
  }, [bancada.ultima_sync, bancada.valvulas, optimistic]);
  useEffect(() => {
    if (!optimistic) return;
    const t = setTimeout(() => setOptimistic(null), 10000);
    return () => clearTimeout(t);
  }, [optimistic]);

  const valvulas = optimistic ?? bancada.valvulas;
  const isPlanta = eq(valvulas, PRESET_PLANTA);
  const isMeio = eq(valvulas, PRESET_MEIO);


  const sendValves = async (v: ValvulasEstado, label: string) => {
    setOptimistic(v); // feedback imediato
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
      setOptimistic(null); // reverte em caso de erro
      toast.error(e instanceof Error ? e.message : "Falha ao enviar comando");
    } finally {
      setSending(false);
    }
  };

  const PRESET_OFF: ValvulasEstado = {
    v1: false, v2: false, v3: false, v4: false, v5: false,
  };

  const sendPause = async (label: string) => {
    setOptimistic(PRESET_OFF); // reflete repouso na hora
    setSending(true);
    try {
      await comandar({
        data: { bancada_id: bancada.id, tipo: "PAUSE" },
      });
      toast.success(label);
    } catch (e) {
      setOptimistic(null);
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
    setOptimistic(PRESET_OFF); // para a animação imediatamente na UI
    try {
      await comandar({
        data: { bancada_id: bancada.id, tipo: "PAUSE" },
      });
      toast.success(`Bancada ${bancada.nome} parada`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Ignora aborts (ex.: HMR/re-render cancela o fetch antes do body ser enviado)
      if (/abort/i.test(msg) || (e as { name?: string })?.name === "AbortError") {
        return;
      }
      setOptimistic(null);
      toast.error(msg || "Falha ao parar bancada");
    } finally {
      setStopping(false);
    }
  };

  return (
    <Card className="card-elevated overflow-hidden transition hover:border-primary/40">
      {laboratorio && (
        <div
          className="h-1.5 w-full"
          style={{ background: laboratorio.cor }}
          aria-hidden
        />
      )}
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 p-4 pb-3 sm:p-6 sm:pb-3">
        <div className="min-w-0">
          <CardTitle className="truncate text-base font-semibold">
            {bancada.nome}
          </CardTitle>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {laboratorio ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
                style={{ borderColor: laboratorio.cor, color: laboratorio.cor }}
                title={`Sala Bioreator: ${laboratorio.nome}`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: laboratorio.cor }}
                />
                {laboratorio.nome}
                {bancada.posicao != null && ` · #${bancada.posicao}`}
              </span>
            ) : (
              <span className="rounded-full border border-dashed px-2 py-0.5 text-[10px] text-muted-foreground">
                Sem sala bioreator
              </span>
            )}
            <p className="font-mono text-[10px] text-muted-foreground">
              NODE-ESP32-{String(bancada.id).slice(0, 6)}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                bancada.luz_ligada
                  ? "border-yellow-500/60 bg-yellow-400/15 text-yellow-700 dark:text-yellow-300"
                  : "border-dashed border-muted-foreground/30 text-muted-foreground/60",
              )}
              title={bancada.luz_ligada ? "Luzes ligadas" : "Luzes desligadas"}
              aria-label={bancada.luz_ligada ? "Luzes ligadas" : "Luzes desligadas"}
            >
              <Lightbulb
                className={cn(
                  "h-3 w-3",
                  bancada.luz_ligada && "fill-current",
                )}
              />
              {bancada.luz_ligada ? "ON" : "OFF"}
            </span>
            {bancada.tem_rtc != null && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  bancada.tem_rtc
                    ? "border-emerald-500/60 bg-emerald-400/15 text-emerald-700 dark:text-emerald-300"
                    : "border-dashed border-muted-foreground/30 text-muted-foreground/60",
                )}
                title={
                  bancada.tem_rtc
                    ? "DS3231 detectado — hora local independente de internet"
                    : "Sem DS3231 — hora vem do NTP + millis()"
                }
                aria-label={bancada.tem_rtc ? "RTC físico ativo" : "Sem RTC físico"}
              >
                <Clock3 className="h-3 w-3" />
                RTC
              </span>
            )}
            <StatusBadge status={bancada.status} />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            há {formatShortDuration(tempoNoEstado(bancada, clock))}
          </span>
        </div>
      </CardHeader>


      <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
        {segments && segments.length > 0 && (
          <StatusTimeline segments={segments} now={clock} />
        )}

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
              <div
                className={cn(
                  "col-span-2 flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-2 text-muted-foreground",
                  sensorComFalha && "border-destructive/40 bg-destructive/5",
                  sensorComAviso && "border-amber-500/40 bg-amber-500/5",
                )}
              >
                {sensorComFalha ? (
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                ) : sensorComAviso ? (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                ) : (
                  <Sprout className="h-4 w-4 text-emerald-500" />
                )}
                <div className="flex-1">
                  <div className="text-[10px] uppercase tracking-wide">
                    Temperatura planta
                  </div>
                  <div className={cn("font-mono text-sm", sensorComFalha ? "text-destructive" : "text-foreground")}>
                    {sensorComFalha
                      ? textoTemperaturaIndisponivel
                      : `${bancada.temperatura_planta!.toFixed(1)} °C`}
                  </div>
                  {sensorComAviso && (
                    <div className="text-[10px] text-amber-600 dark:text-amber-400">
                      Última leitura; sensor sem leitura nova
                    </div>
                  )}
                  {sensorReinicios > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      Reinícios do sensor: {sensorReinicios}
                    </div>
                  )}
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
                  ? "Fluxo da Planta para o Meio"
                  : isMeio
                    ? "Fluxo do Meio para a Planta"
                    : "Sem fluxo ativo"
              }
            >
              <span className="flex shrink-0 items-center gap-1.5">
                <FlaskConical className="h-3.5 w-3.5" />
                Meio
              </span>

              <div
                className={cn("flow-track", isPlanta && "flow-track-reverse")}
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
                className={cn(
                  "h-9 w-full px-2 text-xs whitespace-nowrap",
                  isPlanta
                    ? "bg-emerald-700 text-white hover:bg-emerald-800"
                    : "bg-emerald-200 text-emerald-900 hover:bg-emerald-300 border-emerald-300",
                )}
                variant={isPlanta ? "default" : "outline"}
              >
                <Leaf className="mr-1 h-3.5 w-3.5 shrink-0" />
                Bio Reator Planta
              </Button>
              <Button
                size="sm"
                onClick={toggleMeio}
                disabled={sending}
                className={cn(
                  "h-9 w-full px-2 text-xs whitespace-nowrap",
                  isMeio
                    ? "bg-sky-700 text-white hover:bg-sky-800"
                    : "bg-sky-200 text-sky-900 hover:bg-sky-300 border-sky-300",
                )}
                variant={isMeio ? "default" : "outline"}
              >
                <FlaskConical className="mr-1 h-3.5 w-3.5 shrink-0" />
                Bio Reator Meio
              </Button>
            </div>

            <p className="text-[11px] text-muted-foreground">
              O modo manual pausa o ciclo automático. Clique em{" "}
              <span className="font-semibold">Sair</span> para retomar o
              agendamento programado.
            </p>
          </TabsContent>
        </Tabs>

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-8 flex-1 min-w-0 px-2 text-xs"
            onClick={() => onConfigure(bancada)}
          >
            <Settings2 className="mr-1 h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Configurar</span>
          </Button>
          {tab === "manual" ? (
            <Button
              size="sm"
              onClick={async () => {
                setTab("status");
                setOptimistic(PRESET_OFF);
                try {
                  await comandar({
                    data: { bancada_id: bancada.id, tipo: "PAUSE" },
                  });
                  toast.success("Modo repouso — aguardando próximo ciclo");
                } catch (e) {
                  setOptimistic(null);
                  toast.error(
                    e instanceof Error ? e.message : "Falha ao entrar em repouso",
                  );
                }
              }}
              className="h-8 px-2 text-xs bg-yellow-400 text-yellow-950 hover:bg-yellow-500"
              aria-label="Sair do modo manual e entrar em repouso"
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5 shrink-0" />
              Sair
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => setTab("manual")}
              className="h-8 px-2 text-xs bg-blue-600 text-white hover:bg-blue-700"
              aria-label="Abrir modo manual"
            >
              <SlidersHorizontal className="mr-1 h-3.5 w-3.5 shrink-0" />
              Manual
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleStop}
            disabled={stopping}
            className="h-8 px-2 text-xs bg-red-600 text-white hover:bg-red-700"
            aria-label="Parar bancada"
          >
            <Square className="mr-1 h-3 w-3 shrink-0 fill-current" />
            {stopping ? "…" : "STOP"}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={abrirPareamento}
            disabled={pairing}
            aria-label="Gerar código de pareamento"
            title="Gerar código de pareamento"
          >
            <KeyRound className="h-3.5 w-3.5" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
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


      <AlertDialog open={pairOpen} onOpenChange={setPairOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Código de pareamento</AlertDialogTitle>
            <AlertDialogDescription>
              Digite este código no portal Wi-Fi do ESP32 da bancada{" "}
              <span className="font-semibold">{bancada.nome}</span> para
              re-conectá-la à conta. Válido por 24 horas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="my-4 flex flex-col items-center gap-3">
            {pairing || !pairCode ? (
              <div className="text-sm text-muted-foreground">Gerando…</div>
            ) : (
              <>
                <div className="rounded-lg border bg-muted px-6 py-4 font-mono text-4xl font-bold tracking-[0.4em] tabular-nums">
                  {pairCode}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copiarCodigo}
                  className="h-8 text-xs"
                >
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  Copiar
                </Button>
              </>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Fechar</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
