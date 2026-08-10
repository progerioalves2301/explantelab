import { useEffect, useState } from "react";
import { Clock, Play, Plus, Save, Square, Trash2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  atualizarBancada,
  enviarComando,
  salvarConfig,
  salvarLimitesAlerta,
} from "@/lib/bancadas.functions";
import type { Bancada, Configuracoes, Laboratorio } from "@/lib/types";
import { DEFAULT_CONFIG } from "@/lib/types";

interface Props {
  bancada: Bancada | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  laboratorios?: Laboratorio[];
}

const SEM_LAB = "__sem__";

type Acessorios = {
  tem_sensor_temp: boolean;
  tem_luz: boolean;
  tem_balanca: boolean;
  tem_co2: boolean;
  controla_ar: boolean;
};

const ACESSORIOS: { key: keyof Acessorios; label: string }[] = [
  { key: "tem_sensor_temp", label: "Sensor de temperatura" },
  { key: "tem_luz", label: "Controle de luz" },
  { key: "tem_balanca", label: "Balança" },
  { key: "tem_co2", label: "Sensor de CO₂" },
  { key: "controla_ar", label: "Controla ar-condicionado" },
];

export function BancadaConfigDialog({
  bancada,
  open,
  onOpenChange,
  laboratorios = [],
}: Props) {
  const [nome, setNome] = useState("");
  const [laboratorioId, setLaboratorioId] = useState<string>(SEM_LAB);
  const [posicao, setPosicao] = useState<string>("");
  const [config, setConfig] = useState<Configuracoes>(DEFAULT_CONFIG);
  const [qtdHorarios, setQtdHorarios] = useState<string>("4");
  const [primeiroHorario, setPrimeiroHorario] = useState<string>("06:00");
  const [tempMin, setTempMin] = useState<string>("");
  const [tempMax, setTempMax] = useState<string>("");
  const [offlineThr, setOfflineThr] = useState<string>("420");
  const [acess, setAcess] = useState<Acessorios>({
    tem_sensor_temp: true,
    tem_luz: true,
    tem_balanca: false,
    tem_co2: false,
    controla_ar: false,
  });
  const salvar = useServerFn(salvarConfig);
  const salvarLimites = useServerFn(salvarLimitesAlerta);
  // Perfil declarado da prateleira: sem sensor = sem alertas de temperatura.
  const semSensor = !acess.tem_sensor_temp;

  const atualizar = useServerFn(atualizarBancada);
  const cmd = useServerFn(enviarComando);

  useEffect(() => {
    if (bancada) {
      setNome(bancada.nome);
      setLaboratorioId(bancada.laboratorio_id ?? SEM_LAB);
      setPosicao(bancada.posicao?.toString() ?? "");
      const currentConfig = { ...DEFAULT_CONFIG, ...bancada.config };
      setConfig(currentConfig);
      
      const hs = currentConfig.horarios_disparo ?? [];
      setQtdHorarios(hs.length.toString());
      if (hs.length > 0) setPrimeiroHorario(hs[0]);

      setTempMin(bancada.temp_min?.toString() ?? "");
      setTempMax(bancada.temp_max?.toString() ?? "");
      setOfflineThr((bancada.offline_threshold_segundos || 420).toString());
      setAcess({
        tem_sensor_temp: bancada.tem_sensor_temp ?? true,
        tem_luz: bancada.tem_luz ?? true,
        tem_balanca: bancada.tem_balanca ?? false,
        tem_co2: bancada.tem_co2 ?? false,
        controla_ar: bancada.controla_ar ?? false,
      });
    }
  }, [bancada]);

  if (!bancada) return null;


  const update = (k: keyof Configuracoes, v: string) =>
    setConfig((prev) => ({ ...prev, [k]: Number(v) || 0 }));

  const updateLuz = (idx: number, k: "ligar" | "desligar", v: string) =>
    setConfig((prev) => {
      const list = [...(prev.luz_janelas ?? [])];
      list[idx] = { ...list[idx], [k]: v };
      return { ...prev, luz_janelas: list };
    });

  const addLuz = () =>
    setConfig((prev) => ({
      ...prev,
      luz_janelas: [
        ...(prev.luz_janelas ?? []),
        { ligar: "06:00", desligar: "18:00" },
      ],
    }));

  const removeLuz = (idx: number) =>
    setConfig((prev) => ({
      ...prev,
      luz_janelas: (prev.luz_janelas ?? []).filter((_, i) => i !== idx),
    }));

  const horarios = config.horarios_disparo ?? [];

  const recalcularHorarios = (qtd: number, primeiro: string) => {
    if (qtd <= 0) return;
    const [h, m] = primeiro.split(":").map(Number);
    const startMinutes = h * 60 + m;
    const interval = (24 * 60) / qtd;
    
    const novos = Array.from({ length: qtd }, (_, i) => {
      const totalMinutes = (startMinutes + i * interval) % (24 * 60);
      const hours = Math.floor(totalMinutes / 60);
      const mins = Math.floor(totalMinutes % 60);
      return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
    });

    setConfig((prev) => ({ ...prev, horarios_disparo: novos }));
  };

  const setHorario = (idx: number, v: string) =>
    setConfig((prev) => {
      const list = [...(prev.horarios_disparo ?? [])];
      list[idx] = v;
      return { ...prev, horarios_disparo: list };
    });

  const removeHorario = (idx: number) =>
    setConfig((prev) => {
      const list = (prev.horarios_disparo ?? []).filter((_, i) => i !== idx);
      setQtdHorarios(list.length.toString());
      return { ...prev, horarios_disparo: list };
    });

  const handleSave = async () => {
    const nomeTrim = nome.trim();
    if (nomeTrim.length < 2) {
      toast.error("Nome deve ter pelo menos 2 caracteres");
      return;
    }
    try {
      const posNum = posicao.trim() === "" ? null : Number(posicao);
      await atualizar({
        data: {
          id: bancada.id,
          nome: nomeTrim,
          laboratorio_id: laboratorioId === SEM_LAB ? null : laboratorioId,
          posicao:
            posNum == null || Number.isNaN(posNum) ? null : Math.trunc(posNum),
          ...acess,
        },
      });
      await salvar({ data: { bancada_id: bancada.id, config } });
      await salvarLimites({
        data: {
          bancada_id: bancada.id,
          temp_min: semSensor || tempMin === "" ? null : Number(tempMin),
          temp_max: semSensor || tempMax === "" ? null : Number(tempMax),
          offline_threshold_segundos: Math.max(30, Number(offlineThr) || 420),
        },
      });
      toast.success(`Configuração salva para ${nomeTrim}`);
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
      toast.info(`Prateleira ${bancada.nome} parada`);
    } catch (e) {
      toast.error("Falha ao enviar comando", { description: String(e) });
    }
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-md">
        <DialogHeader className="border-b px-6 pt-6 pb-4">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>Configurar {bancada.nome}</span>
            {(() => {
              const lab = laboratorios.find(
                (l) => l.id === (laboratorioId === SEM_LAB ? null : laboratorioId),
              );
              return lab ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                  style={{ borderColor: lab.cor, color: lab.cor }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: lab.cor }}
                  />
                  {lab.nome}
                  {posicao && ` · #${posicao}`}
                </span>
              ) : (
                <span className="rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground">
                  Sem sala bioreator
                </span>
              );
            })()}
          </DialogTitle>
          <DialogDescription>
            Ajuste os parâmetros do ciclo pneumático. O ESP32 recebe a nova
            config no próximo poll.
          </DialogDescription>
        </DialogHeader>


        <div className="grid gap-4 overflow-y-auto px-6 py-4">

          <div className="grid gap-3 rounded-md border bg-muted/30 p-3">
            <div className="grid gap-1.5">
              <Label htmlFor="b-nome" className="text-xs">Nome</Label>
              <Input
                id="b-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                minLength={2}
                maxLength={60}
                placeholder="Prateleira 01"
              />
            </div>
            <div className="grid grid-cols-[1fr_100px] gap-2">
              <div className="grid gap-1.5">
                <Label className="text-xs">Sala Bioreator</Label>
                <Select value={laboratorioId} onValueChange={setLaboratorioId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sem sala bioreator" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_LAB}>Sem sala bioreator</SelectItem>
                    {laboratorios.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="b-pos" className="text-xs">Posição</Label>
                <Input
                  id="b-pos"
                  type="number"
                  min={1}
                  max={999}
                  value={posicao}
                  onChange={(e) => setPosicao(e.target.value)}
                  placeholder="—"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-3 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-primary" />
                <Label className="text-xs font-semibold">Configurar Ciclos Diários</Label>
              </div>
              <div className="group relative">
                <span className="cursor-help rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary hover:bg-primary/20 transition-colors">?</span>
                <div className="absolute right-0 top-6 z-50 w-64 scale-95 opacity-0 pointer-events-none group-hover:scale-100 group-hover:opacity-100 transition-all duration-200 origin-top-right rounded-md border bg-popover p-3 text-[11px] text-popover-foreground shadow-lg">
                  <p className="font-semibold mb-1 border-b pb-1">Preenchimento Automático:</p>
                  <p>Informe <strong>Ciclos por dia</strong> e o <strong>Primeiro horário</strong>. O sistema distribuirá os ciclos igualmente ao longo das 24 horas.</p>
                  <p className="mt-2 text-[10px] text-muted-foreground italic border-t pt-1">Você pode ajustar os horários manualmente abaixo após o cálculo.</p>
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-[11px] text-muted-foreground">Ciclos por dia</Label>
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={qtdHorarios}
                  onChange={(e) => {
                    setQtdHorarios(e.target.value);
                    const n = Number(e.target.value);
                    if (n > 0 && n <= 24) recalcularHorarios(n, primeiroHorario);
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-[11px] text-muted-foreground">Primeiro horário</Label>
                <Input
                  type="time"
                  value={primeiroHorario}
                  onChange={(e) => {
                    setPrimeiroHorario(e.target.value);
                    recalcularHorarios(Number(qtdHorarios), e.target.value);
                  }}
                />
              </div>
            </div>

            <div className="mt-2 border-t pt-2">
              <Label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">
                Horários calculados (Fuso America/Sao_Paulo)
              </Label>
              <div className="grid grid-cols-3 gap-2">
                {horarios.map((h, idx) => (
                  <div key={idx} className="flex items-center gap-1">
                    <Input
                      type="time"
                      value={h}
                      onChange={(e) => setHorario(idx, e.target.value)}
                      className="h-8 flex-1 px-2 py-1 text-center font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 text-red-600 hover:bg-red-600/10"
                      onClick={() => removeHorario(idx)}
                      disabled={horarios.length <= 1}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
          </div>

          <div className="grid gap-2 rounded-md border bg-muted/30 p-3">
            <Label className="text-xs font-semibold">
              Acessórios instalados
            </Label>
            <p className="text-[10px] text-muted-foreground">
              Só o que estiver marcado aparece no card e gera alertas.
            </p>
            <div className="grid gap-2">
              {ACESSORIOS.map((a) => (
                <div
                  key={a.key}
                  className="flex items-center justify-between gap-3"
                >
                  <Label htmlFor={`ac-${a.key}`} className="text-xs font-normal">
                    {a.label}
                  </Label>
                  <Switch
                    id={`ac-${a.key}`}
                    checked={acess[a.key]}
                    onCheckedChange={(v: boolean) =>
                      setAcess((prev) => ({ ...prev, [a.key]: v }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>

          {acess.tem_luz && (
          <div className="grid gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-xs font-semibold text-yellow-700 dark:text-yellow-400">
                <Clock className="h-3.5 w-3.5" />
                Timer das luzes (GPIO 27)
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={addLuz}
                disabled={(config.luz_janelas ?? []).length >= 8}
              >
                <Plus className="mr-1 h-3 w-3" />
                Nova janela
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Fuso America/Sao_Paulo. Cada janela suporta atravessar meia-noite
              (ex.: liga 20:00, desliga 06:00).
            </p>
            <div className="grid gap-2">
              {(config.luz_janelas ?? []).map((j, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <div className="grid gap-1">
                    <Label className="text-[10px] text-muted-foreground">Ligar</Label>
                    <Input
                      type="time"
                      value={j.ligar}
                      onChange={(e) => updateLuz(idx, "ligar", e.target.value)}
                      className="h-9 font-mono"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-[10px] text-muted-foreground">Desligar</Label>
                    <Input
                      type="time"
                      value={j.desligar}
                      onChange={(e) => updateLuz(idx, "desligar", e.target.value)}
                      className="h-9 font-mono"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-red-600 hover:bg-red-600/10 hover:text-red-600"
                    onClick={() => removeLuz(idx)}
                    disabled={(config.luz_janelas ?? []).length <= 1}
                    aria-label="Remover janela"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          )}



          <div className="grid gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <Label className="text-xs font-semibold text-amber-700 dark:text-amber-400">
              Limites de alerta (Telegram)
            </Label>
            <div className={semSensor ? "grid gap-2" : "grid grid-cols-3 gap-2"}>
              {!semSensor && (
                <>
                  <div className="grid gap-1">
                    <Label htmlFor="tmin" className="text-[11px] text-muted-foreground">Temp mín (°C)</Label>
                    <Input id="tmin" type="number" step="0.1" placeholder="—"
                      value={tempMin} onChange={(e) => setTempMin(e.target.value)} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="tmax" className="text-[11px] text-muted-foreground">Temp máx (°C)</Label>
                    <Input id="tmax" type="number" step="0.1" placeholder="—"
                      value={tempMax} onChange={(e) => setTempMax(e.target.value)} />
                  </div>
                </>
              )}
              <div className="grid gap-1">
                <Label htmlFor="offthr" className="text-[11px] text-muted-foreground">Offline após (s)</Label>
                <Input id="offthr" type="number" min={30} value={offlineThr}
                  onChange={(e) => setOfflineThr(e.target.value)} />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {semSensor
                ? "Prateleira sem sensor de temperatura: alertas de temperatura desativados. Offline padrão: 420s (7 min)."
                : "Deixe temp em branco para desativar. Offline padrão: 420s (7 min)."}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Bateria do RTC: a verificação só é conclusiva depois de uma queda de
              energia. Ver "RTC" sem alerta não garante que a CR2032 esteja nova.
            </p>
          </div>



          <div className="rounded-md border bg-muted/40 p-2 text-[11px] text-muted-foreground">
            <div>ID: <span className="font-mono">{bancada.id}</span></div>
            {bancada.firmware_version && (
              <div>Firmware: {bancada.firmware_version}</div>
            )}
            {bancada.ip_local && <div>IP: {bancada.ip_local}</div>}
          </div>
        </div>

        <DialogFooter className="flex-col-reverse gap-2 border-t bg-background px-6 py-4 sm:flex-row sm:justify-between">
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
