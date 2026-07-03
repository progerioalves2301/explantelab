import { useEffect, useState } from "react";
import { Clock, Play, Plus, Save, Square, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  enviarComando,
  salvarConfig,
} from "@/lib/bancadas.functions";
import type { Bancada, Configuracoes } from "@/lib/types";
import { DEFAULT_CONFIG } from "@/lib/types";

interface Props {
  bancada: Bancada | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BancadaConfigDialog({ bancada, open, onOpenChange }: Props) {
  const [config, setConfig] = useState<Configuracoes>(DEFAULT_CONFIG);
  const salvar = useServerFn(salvarConfig);
  const cmd = useServerFn(enviarComando);

  useEffect(() => {
    if (bancada) setConfig({ ...DEFAULT_CONFIG, ...bancada.config });
  }, [bancada]);

  if (!bancada) return null;

  const update = (k: keyof Configuracoes, v: string) =>
    setConfig((prev) => ({ ...prev, [k]: Number(v) || 0 }));

  const horarios = config.horarios_disparo ?? [];

  const setHorario = (idx: number, v: string) =>
    setConfig((prev) => {
      const list = [...(prev.horarios_disparo ?? [])];
      list[idx] = v;
      return { ...prev, horarios_disparo: list };
    });

  const addHorario = () =>
    setConfig((prev) => ({
      ...prev,
      horarios_disparo: [...(prev.horarios_disparo ?? []), "12:00"],
    }));

  const removeHorario = (idx: number) =>
    setConfig((prev) => ({
      ...prev,
      horarios_disparo: (prev.horarios_disparo ?? []).filter(
        (_, i) => i !== idx,
      ),
    }));

  const handleSave = async () => {
    try {
      await salvar({ data: { bancada_id: bancada.id, config } });
      toast.success(`Configuração salva para ${bancada.nome}`);
      onOpenChange(false);
    } catch (e) {
      toast.error("Falha ao salvar", { description: String(e) });
    }
  };

  const handleForceCycle = async () => {
    try {
      await cmd({ data: { bancada_id: bancada.id, tipo: "FORCE_CYCLE" } });
      toast.warning(`Ciclo manual disparado em ${bancada.nome}`);
    } catch (e) {
      toast.error("Falha ao enviar comando", { description: String(e) });
    }
  };

  const handleStop = async () => {
    try {
      await cmd({ data: { bancada_id: bancada.id, tipo: "PAUSE" } });
      toast.info(`Bancada ${bancada.nome} parada`);
    } catch (e) {
      toast.error("Falha ao enviar comando", { description: String(e) });
    }
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configurar {bancada.nome}</DialogTitle>
          <DialogDescription>
            Ajuste os parâmetros do ciclo pneumático. O ESP32 recebe a nova
            config no próximo poll.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-primary" />
                Horários de disparo por dia
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addHorario}
                disabled={horarios.length >= 24}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Adicionar
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Fuso America/Sao_Paulo. O ciclo dispara automaticamente em cada
              horário listado.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {horarios.map((h, idx) => (
                <div key={idx} className="flex items-center gap-1">
                  <Input
                    type="time"
                    value={h}
                    onChange={(e) => setHorario(idx, e.target.value)}
                    className="font-mono"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeHorario(idx)}
                    disabled={horarios.length <= 1}
                    aria-label="Remover horário"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="grid gap-2">
              <Label htmlFor="inj" className="text-xs">Injeção (s)</Label>
              <Input id="inj" type="number" min={1} value={config.tempo_injecao_segundos}
                onChange={(e) => update("tempo_injecao_segundos", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pausa" className="text-xs">Pausa (s)</Label>
              <Input id="pausa" type="number" min={0} value={config.tempo_pausa_segundos}
                onChange={(e) => update("tempo_pausa_segundos", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ret" className="text-xs">Retorno (s)</Label>
              <Input id="ret" type="number" min={1} value={config.tempo_retorno_segundos}
                onChange={(e) => update("tempo_retorno_segundos", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="al" className="text-xs">Alívio (s)</Label>
              <Input id="al" type="number" min={0} value={config.tempo_alivio_segundos}
                onChange={(e) => update("tempo_alivio_segundos", e.target.value)} />
            </div>
          </div>

          <div className="rounded-md border bg-muted/40 p-2 text-[11px] text-muted-foreground">
            <div>ID: <span className="font-mono">{bancada.id}</span></div>
            {bancada.firmware_version && (
              <div>Firmware: {bancada.firmware_version}</div>
            )}
            {bancada.ip_local && <div>IP: {bancada.ip_local}</div>}
          </div>
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleForceCycle}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Play className="mr-1.5 h-4 w-4" />
              Forçar ciclo
            </Button>
            <Button
              size="sm"
              onClick={handleStop}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              <Square className="mr-1.5 h-4 w-4 fill-current" />
              Parar
            </Button>
          </div>
          <Button onClick={handleSave}>
            <Save className="mr-1.5 h-4 w-4" />
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
