import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Wind, Plus, Trash2, RefreshCw, Copy } from "lucide-react";
import { format } from "date-fns";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  listarSensoresCo2, criarSensorCo2, removerSensorCo2, listarHistoricoCo2,
  type SensorCo2, type PontoCo2, type PeriodoCo2,
} from "@/lib/co2.functions";
import { listLaboratorios } from "@/lib/laboratorios.functions";
import type { Laboratorio } from "@/lib/types";

export const Route = createFileRoute("/_shell/co2")({
  head: () => ({
    meta: [
      { title: "Sensores de CO₂ — VitroCeres OS" },
      { name: "description", content: "Monitoramento de CO₂ por sala do laboratório." },
    ],
  }),
  component: Co2Page,
});

function Co2Page() {
  const listSensores = useServerFn(listarSensoresCo2);
  const criar = useServerFn(criarSensorCo2);
  const remover = useServerFn(removerSensorCo2);
  const listLabs = useServerFn(listLaboratorios);
  const histFn = useServerFn(listarHistoricoCo2);

  const [sensores, setSensores] = useState<SensorCo2[]>([]);
  const [labs, setLabs] = useState<Laboratorio[]>([]);
  const [historico, setHistorico] = useState<Record<string, PontoCo2[]>>({});
  const [periodo, setPeriodo] = useState<PeriodoCo2>("24h");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [novoLab, setNovoLab] = useState<string>("");
  const [novoNome, setNovoNome] = useState<string>("");

  const carregar = async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([listSensores(), listLabs()]);
      setSensores(s);
      setLabs(l);
      const labIds = Array.from(new Set(s.map((x) => x.laboratorio_id)));
      const entries = await Promise.all(
        labIds.map(async (id) => [id, await histFn({ data: { laboratorio_id: id, periodo } })] as const),
      );
      setHistorico(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void carregar(); /* eslint-disable-next-line */ }, [periodo]);

  const porLab = useMemo(() => {
    const map = new Map<string, SensorCo2[]>();
    for (const s of sensores) {
      const arr = map.get(s.laboratorio_id) ?? [];
      arr.push(s);
      map.set(s.laboratorio_id, arr);
    }
    return map;
  }, [sensores]);

  const handleCriar = async () => {
    if (!novoLab || !novoNome.trim()) {
      toast.error("Informe sala e nome");
      return;
    }
    try {
      await criar({ data: { laboratorio_id: novoLab, nome: novoNome.trim() } });
      toast.success("Sensor cadastrado");
      setDialogOpen(false);
      setNovoNome("");
      setNovoLab("");
      void carregar();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Wind className="h-6 w-6 text-primary" /> Sensores de CO₂
          </h1>
          <p className="text-sm text-muted-foreground">
            Monitoramento contínuo de CO₂ (ppm) por sala.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={periodo} onValueChange={(v) => setPeriodo(v as PeriodoCo2)}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="6h">6h</SelectItem>
              <SelectItem value="24h">24h</SelectItem>
              <SelectItem value="7d">7 dias</SelectItem>
              <SelectItem value="30d">30 dias</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1.5 h-4 w-4" /> Novo sensor</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Cadastrar sensor de CO₂</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Sala</Label>
                  <Select value={novoLab} onValueChange={setNovoLab}>
                    <SelectTrigger><SelectValue placeholder="Selecione a sala" /></SelectTrigger>
                    <SelectContent>
                      {labs.map((l) => <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Nome</Label>
                  <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Ex.: Sensor porta" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                <Button onClick={handleCriar}>Cadastrar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {labs.length === 0 && !loading && (
        <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">
          Cadastre uma sala primeiro em "Salas Bioreator".
        </CardContent></Card>
      )}

      {labs.map((lab) => {
        const listaSensores = porLab.get(lab.id) ?? [];
        const pts = historico[lab.id] ?? [];
        const valores = pts.map((p) => p.ppm);
        const ultimo = valores[valores.length - 1] ?? null;
        const min = valores.length ? Math.min(...valores) : null;
        const max = valores.length ? Math.max(...valores) : null;
        const media = valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null;
        const dados = pts.map((p) => ({
          ts: new Date(p.medido_em).getTime(),
          label: format(new Date(p.medido_em), "dd/MM HH:mm"),
          ppm: p.ppm,
        }));

        return (
          <Card key={lab.id}>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                {lab.nome}
                <Badge variant="outline" className="font-normal">
                  {listaSensores.length} sensor{listaSensores.length === 1 ? "" : "es"}
                </Badge>
              </CardTitle>
              <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                <span>Atual: <b>{ultimo != null ? `${ultimo.toFixed(0)} ppm` : "—"}</b></span>
                <span>Média: {media != null ? `${media.toFixed(0)}` : "—"}</span>
                <span>Mín/Máx: {min != null && max != null ? `${min.toFixed(0)} / ${max.toFixed(0)}` : "—"}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {pts.length === 0 ? (
                <div className="grid h-[240px] place-items-center text-sm text-muted-foreground">
                  Sem leituras no período.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={dados} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="label" minTickGap={40} tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}`} width={55} />
                    <Tooltip
                      formatter={(v: number) => [`${v.toFixed(0)} ppm`, "CO₂"]}
                      contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
                    />
                    <Line type="monotone" dataKey="ppm" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}

              {listaSensores.length > 0 && (
                <div className="divide-y rounded-md border">
                  {listaSensores.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium">{s.nome}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          Token: <code className="font-mono">{s.device_token.slice(0, 8)}…</code>
                          {s.ultima_medicao_em ? ` · última: ${format(new Date(s.ultima_medicao_em), "dd/MM HH:mm")}` : " · sem leituras"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {s.ultima_leitura_ppm != null && (
                          <Badge variant="secondary" className="tabular-nums">{Number(s.ultima_leitura_ppm).toFixed(0)} ppm</Badge>
                        )}
                        <Button
                          size="sm" variant="ghost"
                          onClick={async () => {
                            await navigator.clipboard.writeText(s.device_token);
                            toast.success("Token copiado");
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm" variant="ghost" className="text-destructive"
                          onClick={async () => {
                            if (!confirm(`Remover sensor "${s.nome}"?`)) return;
                            await remover({ data: { id: s.id } });
                            toast.success("Sensor removido");
                            void carregar();
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
