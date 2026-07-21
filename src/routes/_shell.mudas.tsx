import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sprout, Plus, Scale, LineChart as LineChartIcon, Trash2, CheckCircle2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  listarMudas, criarMuda, encerrarMuda, excluirMuda,
  registrarPesagem, type Muda,
} from "@/lib/mudas.functions";
import { listLaboratorios } from "@/lib/laboratorios.functions";
import { listBancadas } from "@/lib/bancadas.functions";
import type { Laboratorio, Bancada } from "@/lib/types";

export const Route = createFileRoute("/_shell/mudas")({
  head: () => ({
    meta: [
      { title: "Mudas & Pesagem — VitroCeres OS" },
      { name: "description", content: "Cadastro de mudas e registro de pesagens (curva de crescimento)." },
    ],
  }),
  component: MudasPage,
});

function MudasPage() {
  const listar = useServerFn(listarMudas);
  const criar = useServerFn(criarMuda);
  const encerrar = useServerFn(encerrarMuda);
  const excluir = useServerFn(excluirMuda);
  const pesar = useServerFn(registrarPesagem);
  const listLabs = useServerFn(listLaboratorios);
  const listBs = useServerFn(listBancadas);

  const [mudas, setMudas] = useState<Muda[]>([]);
  const [labs, setLabs] = useState<Laboratorio[]>([]);
  const [bancadas, setBancadas] = useState<Bancada[]>([]);
  const [loading, setLoading] = useState(true);
  const [apenasAtivas, setApenasAtivas] = useState(true);

  const [openNova, setOpenNova] = useState(false);
  const [openPesar, setOpenPesar] = useState<Muda | null>(null);

  const carregar = async () => {
    setLoading(true);
    try {
      const [m, l, b] = await Promise.all([
        listar({ data: { apenas_ativas: apenasAtivas } }),
        listLabs(),
        listBs(),
      ]);
      setMudas(m);
      setLabs(l);
      setBancadas(b);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void carregar(); /* eslint-disable-next-line */ }, [apenasAtivas]);

  const labById = useMemo(() => new Map(labs.map((l) => [l.id, l])), [labs]);
  const bancadaById = useMemo(() => new Map(bancadas.map((b) => [b.id, b])), [bancadas]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Sprout className="h-6 w-6 text-primary" />
            Mudas & Pesagem
          </h1>
          <p className="text-sm text-muted-foreground">
            Cadastre mudas e registre pesagens para acompanhar a curva de crescimento.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setApenasAtivas((v) => !v)}
          >
            {apenasAtivas ? "Mostrar todas" : "Só ativas"}
          </Button>
          <Dialog open={openNova} onOpenChange={setOpenNova}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1.5 h-4 w-4" /> Nova muda
              </Button>
            </DialogTrigger>
            <NovaMudaDialog
              labs={labs}
              bancadas={bancadas}
              onCreated={async () => {
                setOpenNova(false);
                await carregar();
              }}
              criar={criar}
            />
          </Dialog>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : mudas.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma muda cadastrada ainda. Clique em <b>Nova muda</b> para começar.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {mudas.map((m) => {
            const lab = m.laboratorio_id ? labById.get(m.laboratorio_id) : null;
            const banc = m.bancada_id ? bancadaById.get(m.bancada_id) : null;
            return (
              <Card key={m.id} className={!m.ativa ? "opacity-70" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base break-words">{m.identificador}</CardTitle>
                      {m.especie && (
                        <p className="text-xs text-muted-foreground">{m.especie}</p>
                      )}
                    </div>
                    {m.ativa ? (
                      <Badge variant="secondary">ativa</Badge>
                    ) : (
                      <Badge variant="outline">encerrada</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="flex flex-wrap gap-1">
                    {lab && <Badge variant="outline">Sala: {lab.nome}</Badge>}
                    {banc && <Badge variant="outline">Prat.: {banc.nome}</Badge>}
                  </div>
                  <div className="text-muted-foreground tabular-nums">
                    Início: {new Date(m.data_inicio).toLocaleDateString("pt-BR")}
                    {m.data_fim && ` · Fim: ${new Date(m.data_fim).toLocaleDateString("pt-BR")}`}
                  </div>
                  {m.peso_inicial_g != null && (
                    <div className="text-muted-foreground">
                      Peso inicial: <b>{Number(m.peso_inicial_g).toFixed(2)} g</b>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button size="sm" variant="default" onClick={() => setOpenPesar(m)} disabled={!m.ativa}>
                      <Scale className="mr-1 h-3.5 w-3.5" /> Pesar
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/mudas/$id" params={{ id: m.id }}>
                        <LineChartIcon className="mr-1 h-3.5 w-3.5" /> Curva
                      </Link>
                    </Button>
                    {m.ativa && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          await encerrar({ data: { id: m.id } });
                          toast.success("Muda encerrada");
                          void carregar();
                        }}
                      >
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Encerrar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={async () => {
                        if (!confirm(`Excluir muda "${m.identificador}" e todas as pesagens?`)) return;
                        await excluir({ data: { id: m.id } });
                        toast.success("Muda excluída");
                        void carregar();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!openPesar} onOpenChange={(v) => !v && setOpenPesar(null)}>
        {openPesar && (
          <PesarDialog
            muda={openPesar}
            onDone={async () => {
              setOpenPesar(null);
              await carregar();
            }}
            pesar={pesar}
          />
        )}
      </Dialog>
    </div>
  );
}

function NovaMudaDialog({
  labs, bancadas, onCreated, criar,
}: {
  labs: Laboratorio[];
  bancadas: Bancada[];
  onCreated: () => void;
  criar: ReturnType<typeof useServerFn<typeof criarMuda>>;
}) {
  const [identificador, setId] = useState("");
  const [especie, setEspecie] = useState("");
  const [labId, setLabId] = useState<string>("");
  const [bancId, setBancId] = useState<string>("");
  const [peso, setPeso] = useState<string>("");
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);

  const bancadasDaSala = bancadas.filter((b) => !labId || b.laboratorio_id === labId);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Nova muda</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Variedade *</Label>
          <Input value={identificador} onChange={(e) => setId(e.target.value)} placeholder="Ex.: Cannabis Sativa, Framboesa…" />
        </div>
        <div>
          <Label>Espécie / cultivar</Label>
          <Input value={especie} onChange={(e) => setEspecie(e.target.value)} placeholder="Ex.: Cannabis, Framboesa…" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Sala</Label>
            <Select value={labId} onValueChange={(v) => { setLabId(v); setBancId(""); }}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {labs.map((l) => <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Prateleira</Label>
            <Select value={bancId} onValueChange={setBancId} disabled={!labId}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {bancadasDaSala.map((b) => <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Peso inicial (g)</Label>
          <Input
            type="number" step="0.01" min="0"
            value={peso} onChange={(e) => setPeso(e.target.value)}
            placeholder="opcional — vira a 1ª medição"
          />
        </div>
        <div>
          <Label>Observações</Label>
          <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} />
        </div>
      </div>
      <DialogFooter>
        <Button
          onClick={async () => {
            if (!identificador.trim()) { toast.error("Informe a variedade"); return; }
            setSaving(true);
            try {
              await criar({
                data: {
                  identificador: identificador.trim(),
                  especie: especie.trim() || null,
                  laboratorio_id: labId || null,
                  bancada_id: bancId || null,
                  peso_inicial_g: peso ? Number(peso) : null,
                  observacoes: obs.trim() || null,
                },
              });
              toast.success("Muda cadastrada");
              onCreated();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Erro ao cadastrar");
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving}
        >
          {saving ? "Salvando…" : "Cadastrar"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function PesarDialog({
  muda, onDone, pesar,
}: {
  muda: Muda;
  onDone: () => void;
  pesar: ReturnType<typeof useServerFn<typeof registrarPesagem>>;
}) {
  const [valor, setValor] = useState("");
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Pesar muda — {muda.identificador}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Peso atual (g) *</Label>
          <Input
            type="number" step="0.01" min="0" autoFocus
            value={valor} onChange={(e) => setValor(e.target.value)}
          />
        </div>
        <div>
          <Label>Observações</Label>
          <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} />
        </div>
      </div>
      <DialogFooter>
        <Button
          onClick={async () => {
            const v = Number(valor);
            if (!Number.isFinite(v) || v < 0) { toast.error("Peso inválido"); return; }
            setSaving(true);
            try {
              await pesar({ data: { muda_id: muda.id, valor_g: v, observacoes: obs.trim() || null } });
              toast.success("Pesagem registrada");
              onDone();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Erro ao registrar");
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving}
        >
          {saving ? "Salvando…" : "Registrar"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
