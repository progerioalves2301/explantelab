import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Save, Send, Trash2, Clock } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_CONFIG, type Configuracoes, type Laboratorio } from "@/lib/types";
import {
  getDefaultCiclo,
  salvarDefaultCiclo,
} from "@/lib/settings.functions";
import { aplicarConfigEmMassa } from "@/lib/bancadas.functions";

export const Route = createFileRoute("/_shell/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — GeneLab IoT" },
      {
        name: "description",
        content: "Ciclo padrão da instalação e aplicação em massa por sala bioreator.",
      },
    ],
  }),
  component: ConfigPage,
});

const ESCOPO_TODAS = "__todas__";

function ConfigPage() {
  const [config, setConfig] = useState<Configuracoes>(DEFAULT_CONFIG);
  const [labs, setLabs] = useState<Laboratorio[]>([]);
  const [escopo, setEscopo] = useState<string>(ESCOPO_TODAS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aplicando, setAplicando] = useState(false);

  const carregar = useServerFn(getDefaultCiclo);
  const salvarPadrao = useServerFn(salvarDefaultCiclo);
  const aplicar = useServerFn(aplicarConfigEmMassa);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cfg, labsRes] = await Promise.all([
          carregar(),
          supabase
            .from("laboratorios")
            .select("*")
            .order("ordem", { ascending: true }),
        ]);
        if (!alive) return;
        setConfig(cfg as Configuracoes);
        setLabs((labsRes.data ?? []) as unknown as Laboratorio[]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao carregar");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [carregar]);

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

  const handleSavePadrao = async () => {
    setSaving(true);
    try {
      await salvarPadrao({ data: { config } });
      toast.success("Ciclo padrão salvo — novas bancadas nascem com essa config");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar padrão");
    } finally {
      setSaving(false);
    }
  };

  const handleAplicar = async () => {
    setAplicando(true);
    try {
      const res = await aplicar({
        data: {
          escopo: escopo === ESCOPO_TODAS ? "todas" : "laboratorio",
          laboratorio_id: escopo === ESCOPO_TODAS ? null : escopo,
          config,
        },
      });
      toast.success(
        `Config aplicada a ${res.atualizadas} bancada(s) — ESP32 recebe no próximo poll`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao aplicar");
    } finally {
      setAplicando(false);
    }
  };

  const escopoLabel =
    escopo === ESCOPO_TODAS
      ? "TODAS as bancadas da instalação"
      : `todas as bancadas do sala bioreator "${labs.find((l) => l.id === escopo)?.nome ?? "?"}"`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Ciclo padrão da instalação. Serve de base para novas bancadas e pode
          ser aplicado em massa a um sala bioreator inteiro.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <Card className="card-elevated">
          <CardHeader>
            <CardTitle>Ciclo pneumático padrão</CardTitle>
            <CardDescription>
              Repouso → Injeção (V1+V4) → Pausa → Retorno (V2+V3) → Alívio (V5).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field
                id="inj"
                label="Injeção (s)"
                value={config.tempo_injecao_segundos}
                onChange={(v) => update("tempo_injecao_segundos", v)}
              />
              <Field
                id="pausa"
                label="Pausa (s)"
                value={config.tempo_pausa_segundos}
                onChange={(v) => update("tempo_pausa_segundos", v)}
              />
              <Field
                id="ret"
                label="Retorno (s)"
                value={config.tempo_retorno_segundos}
                onChange={(v) => update("tempo_retorno_segundos", v)}
              />
              <Field
                id="al"
                label="Alívio (s)"
                value={config.tempo_alivio_segundos}
                onChange={(v) => update("tempo_alivio_segundos", v)}
              />
            </div>

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
                Fuso America/Sao_Paulo.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
                      className="h-8 w-8 shrink-0 text-red-600 hover:bg-red-600/10 hover:text-red-600"
                      onClick={() => removeHorario(idx)}
                      disabled={horarios.length <= 1}
                      aria-label="Remover horário"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-xs font-semibold text-yellow-700 dark:text-yellow-400">
                  <Clock className="h-3.5 w-3.5" />
                  Timer das luzes da bancada (GPIO 27)
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addLuz}
                  disabled={(config.luz_janelas ?? []).length >= 8}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Nova janela
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Fuso America/Sao_Paulo. Cada janela suporta atravessar
                meia-noite (ex.: ligar 20:00, desligar 06:00).
              </p>
              <div className="grid gap-2">
                {(config.luz_janelas ?? []).map((j, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                    <div className="grid gap-1">
                      <Label className="text-[11px] text-muted-foreground">Ligar</Label>
                      <Input
                        type="time"
                        value={j.ligar}
                        onChange={(e) => updateLuz(idx, "ligar", e.target.value)}
                        className="font-mono"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-[11px] text-muted-foreground">Desligar</Label>
                      <Input
                        type="time"
                        value={j.desligar}
                        onChange={(e) => updateLuz(idx, "desligar", e.target.value)}
                        className="font-mono"
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


            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Salvar padrão só afeta bancadas <em>novas</em>. Para atualizar
                bancadas existentes, use "Aplicar em massa" abaixo.
              </p>
              <Button onClick={handleSavePadrao} disabled={saving}>
                <Save className="mr-1.5 h-4 w-4" />
                {saving ? "Salvando…" : "Salvar padrão"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="card-elevated border-amber-500/30">
        <CardHeader>
          <CardTitle className="text-base">Aplicar em massa</CardTitle>
          <CardDescription>
            Sobrescreve a config de todas as bancadas do escopo escolhido com o
            ciclo acima e envia UPDATE_CONFIG para cada ESP32.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label className="text-xs">Escopo</Label>
            <Select value={escopo} onValueChange={setEscopo}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ESCOPO_TODAS}>
                  Todas as bancadas (instalação inteira)
                </SelectItem>
                {labs.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    Sala Bioreator: {l.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                disabled={aplicando}
                className="bg-amber-600 text-white hover:bg-amber-700"
              >
                <Send className="mr-1.5 h-4 w-4" />
                {aplicando ? "Aplicando…" : "Aplicar em massa"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmar aplicação em massa</AlertDialogTitle>
                <AlertDialogDescription>
                  A config atual será gravada em {escopoLabel} e cada ESP32
                  receberá UPDATE_CONFIG no próximo poll. Ação irreversível
                  (não há histórico da config anterior).
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleAplicar}
                  className="bg-amber-600 text-white hover:bg-amber-700"
                >
                  Aplicar agora
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
