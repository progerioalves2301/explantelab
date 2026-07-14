import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AirVent, Plus, Power, Radio, Save, Trash2, Wind } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  listArCondicionados,
  salvarArCondicionado,
  excluirArCondicionado,
  testarArCondicionado,
  aprenderIr,
  PROTOCOLOS_IR,
  type ArCondicionado,
} from "@/lib/ar-condicionado.functions";
import { listLaboratorios } from "@/lib/laboratorios.functions";
import { listBancadas } from "@/lib/bancadas.functions";
import type { Bancada, Laboratorio } from "@/lib/types";

export const Route = createFileRoute("/_shell/ar-condicionado")({
  head: () => ({
    meta: [
      { title: "Ar-condicionado — VitroCeres OS" },
      { name: "description", content: "Controle automático de ar-condicionado por sala bioreator, com histerese sobre a temperatura das prateleiras." },
    ],
  }),
  component: ArCondicionadoPage,
});

type FormState = {
  id: string | null;
  laboratorio_id: string;
  bancada_controladora_id: string | null;
  marca: string;
  modelo: string;
  ir_protocol: string;
  ativo: boolean;
  setpoint_min: number;
  setpoint_max: number;
  histerese: number;
  intervalo_min_comando_s: number;
  agregacao: "media" | "maxima";
};

function emptyForm(labs: Laboratorio[]): FormState {
  return {
    id: null,
    laboratorio_id: labs[0]?.id ?? "",
    bancada_controladora_id: null,
    marca: "LG",
    modelo: "",
    ir_protocol: "LG",
    ativo: true,
    setpoint_min: 22,
    setpoint_max: 26,
    histerese: 1,
    intervalo_min_comando_s: 180,
    agregacao: "maxima",
  };
}

function ArCondicionadoPage() {
  const listAr = useServerFn(listArCondicionados);
  const listLabs = useServerFn(listLaboratorios);
  const listB = useServerFn(listBancadas);
  const salvar = useServerFn(salvarArCondicionado);
  const excluir = useServerFn(excluirArCondicionado);
  const testar = useServerFn(testarArCondicionado);
  const aprender = useServerFn(aprenderIr);

  const [ars, setArs] = useState<ArCondicionado[]>([]);
  const [labs, setLabs] = useState<Laboratorio[]>([]);
  const [bancadas, setBancadas] = useState<Bancada[]>([]);
  const [editing, setEditing] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const reload = async () => {
    const [a, l, b] = await Promise.all([listAr(), listLabs(), listB()]);
    setArs(a);
    setLabs(l);
    setBancadas(b);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const salasSemAr = useMemo(
    () => labs.filter((l) => !ars.some((a) => a.laboratorio_id === l.id)),
    [labs, ars],
  );

  const bancadasDaSala = (labId: string) =>
    bancadas.filter((b) => b.laboratorio_id === labId);

  const startNew = () => {
    if (salasSemAr.length === 0) {
      toast.error("Todas as salas já têm ar cadastrado");
      return;
    }
    setEditing({ ...emptyForm(labs), laboratorio_id: salasSemAr[0].id });
  };

  const startEdit = (ar: ArCondicionado) => {
    setEditing({
      id: ar.id,
      laboratorio_id: ar.laboratorio_id,
      bancada_controladora_id: ar.bancada_controladora_id,
      marca: ar.marca,
      modelo: ar.modelo ?? "",
      ir_protocol: ar.ir_protocol,
      ativo: ar.ativo,
      setpoint_min: Number(ar.setpoint_min),
      setpoint_max: Number(ar.setpoint_max),
      histerese: Number(ar.histerese),
      intervalo_min_comando_s: ar.intervalo_min_comando_s,
      agregacao: ar.agregacao,
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.laboratorio_id) return toast.error("Escolha uma sala");
    if (!editing.bancada_controladora_id)
      return toast.error("Escolha a prateleira que vai controlar o ar (emissor IR no GPIO 32)");
    if (editing.setpoint_min >= editing.setpoint_max)
      return toast.error("Setpoint mín deve ser menor que máx");
    setSaving(true);
    try {
      await salvar({
        data: {
          id: editing.id,
          laboratorio_id: editing.laboratorio_id,
          bancada_controladora_id: editing.bancada_controladora_id,
          marca: editing.marca,
          modelo: editing.modelo || null,
          ir_protocol: editing.ir_protocol as
            | "LG"
            | "SAMSUNG"
            | "FUJITSU"
            | "MIDEA"
            | "ELECTROLUX"
            | "ELECTRA"
            | "CONSUL",
          ativo: editing.ativo,
          setpoint_min: editing.setpoint_min,
          setpoint_max: editing.setpoint_max,
          histerese: editing.histerese,
          intervalo_min_comando_s: editing.intervalo_min_comando_s,
          agregacao: editing.agregacao,
        },
      });
      toast.success("Ar-condicionado salvo");
      setEditing(null);
      await reload();
    } catch (e) {
      toast.error("Falha ao salvar", { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir configuração do ar-condicionado?")) return;
    try {
      await excluir({ data: { id } });
      toast.success("Removido");
      await reload();
    } catch (e) {
      toast.error("Falha", { description: String(e) });
    }
  };

  const handleTestar = async (id: string, acao: "on" | "off") => {
    setTestingId(id);
    try {
      await testar({ data: { id, acao } });
      toast.success(`Comando ${acao === "on" ? "LIGAR" : "DESLIGAR"} enviado`);
      await reload();
    } catch (e) {
      toast.error("Falha ao testar", { description: String(e) });
    } finally {
      setTestingId(null);
    }
  };

  const handleAprender = async (id: string) => {
    setTestingId(id);
    try {
      const r = await aprender({ data: { id, timeout_s: 30 } });
      toast.success("Modo aprender IR ativado", {
        description: `Aponte o controle para a prateleira e aperte LIGAR nos próximos ${r.timeout_s}s.`,
      });
      // Recarrega depois da janela para pegar o código gravado.
      setTimeout(() => { void reload(); }, (r.timeout_s + 3) * 1000);
    } catch (e) {
      toast.error("Falha ao aprender IR", { description: String(e) });
    } finally {
      setTestingId(null);
    }
  };


  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <AirVent className="h-6 w-6 text-primary" />
            Ar-condicionado
          </h1>
          <p className="text-sm text-muted-foreground">
            Um ar por sala bioreator. A prateleira controladora emite os comandos
            IR pelo <strong>GPIO 32</strong> e mantém a temperatura das plantas
            dentro da faixa definida.
          </p>
        </div>
        <Button onClick={startNew} disabled={salasSemAr.length === 0}>
          <Plus className="mr-1.5 h-4 w-4" />
          Novo ar
        </Button>
      </div>

      {ars.length === 0 && !editing && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <Wind className="mx-auto mb-3 h-10 w-10 opacity-40" />
            Nenhum ar-condicionado cadastrado. Clique em "Novo ar" para começar.
          </CardContent>
        </Card>
      )}

      {ars.map((ar) => {
        const lab = labs.find((l) => l.id === ar.laboratorio_id);
        const ctrl = bancadas.find((b) => b.id === ar.bancada_controladora_id);
        return (
          <Card key={ar.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: lab?.cor ?? "#888" }}
                />
                {lab?.nome ?? "Sala removida"}
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    ar.ligado
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {ar.ligado ? `LIGADO ${ar.setpoint_atual ?? "-"}°C` : "DESLIGADO"}
                </span>
                {!ar.ativo && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                    INATIVO
                  </span>
                )}
                {ar.codigo_ir_raw && ar.codigo_ir_raw.length > 0 && (
                  <span
                    className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-400"
                    title={`${ar.codigo_ir_raw.length} pulsos aprendidos`}
                  >
                    IR APRENDIDO
                  </span>
                )}
              </CardTitle>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testingId === ar.id}
                  onClick={() => handleAprender(ar.id)}
                  title="Coloca a prateleira em modo aprender por 30s; aperte LIGAR no controle real apontando para o receptor"
                >
                  <Radio className="mr-1 h-3.5 w-3.5" />
                  Aprender IR
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testingId === ar.id}
                  onClick={() => handleTestar(ar.id, "on")}
                >
                  <Power className="mr-1 h-3.5 w-3.5" />
                  Testar ON
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testingId === ar.id}
                  onClick={() => handleTestar(ar.id, "off")}
                >
                  Testar OFF
                </Button>
                <Button size="sm" variant="ghost" onClick={() => startEdit(ar)}>
                  Editar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600 hover:text-red-600"
                  onClick={() => handleDelete(ar.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <div className="text-xs text-muted-foreground">Protocolo IR</div>
                <div>{ar.ir_protocol} · {ar.marca}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Controladora</div>
                <div>{ctrl?.nome ?? <span className="text-red-600">Não definida</span>}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Faixa</div>
                <div>{ar.setpoint_min}°C – {ar.setpoint_max}°C</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Última temp (sala)</div>
                <div>{ar.ultimo_temp_lida != null ? `${ar.ultimo_temp_lida}°C` : "—"}</div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {editing && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle>{editing.id ? "Editar" : "Novo"} ar-condicionado</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Sala bioreator</Label>
                <Select
                  value={editing.laboratorio_id}
                  onValueChange={(v) =>
                    setEditing({ ...editing, laboratorio_id: v, bancada_controladora_id: null })
                  }
                  disabled={!!editing.id}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {labs.map((l) => {
                      const jaTem = ars.some(
                        (a) => a.laboratorio_id === l.id && a.id !== editing.id,
                      );
                      return (
                        <SelectItem key={l.id} value={l.id} disabled={jaTem}>
                          {l.nome}{jaTem ? " (já tem ar)" : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>
                  Prateleira controladora <span className="text-red-600">*</span>
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    (LED IR no GPIO 32)
                  </span>
                </Label>
                <Select
                  value={editing.bancada_controladora_id ?? ""}
                  onValueChange={(v) =>
                    setEditing({ ...editing, bancada_controladora_id: v || null })
                  }
                >
                  <SelectTrigger
                    className={
                      editing.bancada_controladora_id ? "" : "border-red-500 ring-1 ring-red-500/40"
                    }
                  >
                    <SelectValue placeholder="Escolha uma prateleira da sala (ex.: 0102)" />
                  </SelectTrigger>
                  <SelectContent>
                    {bancadasDaSala(editing.laboratorio_id).length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        Nenhuma prateleira cadastrada nesta sala
                      </div>
                    )}
                    {bancadasDaSala(editing.laboratorio_id).map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Essa prateleira recebe os comandos IR e dispara o ar pra sala inteira.
                </p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label>Marca</Label>
                <Input
                  value={editing.marca}
                  onChange={(e) => setEditing({ ...editing, marca: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Modelo (opcional)</Label>
                <Input
                  value={editing.modelo}
                  onChange={(e) => setEditing({ ...editing, modelo: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Protocolo IR</Label>
                <Select
                  value={editing.ir_protocol}
                  onValueChange={(v) => setEditing({ ...editing, ir_protocol: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROTOCOLOS_IR.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-4">
              <div className="grid gap-1.5">
                <Label>Setpoint mín (°C)</Label>
                <Input
                  type="number" step="0.5" min={16} max={30}
                  value={editing.setpoint_min}
                  onChange={(e) => setEditing({ ...editing, setpoint_min: Number(e.target.value) })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Setpoint máx (°C)</Label>
                <Input
                  type="number" step="0.5" min={16} max={30}
                  value={editing.setpoint_max}
                  onChange={(e) => setEditing({ ...editing, setpoint_max: Number(e.target.value) })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Histerese (°C)</Label>
                <Input
                  type="number" step="0.1" min={0.1} max={5}
                  value={editing.histerese}
                  onChange={(e) => setEditing({ ...editing, histerese: Number(e.target.value) })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Intervalo mín entre cmds (s)</Label>
                <Input
                  type="number" min={30} max={3600}
                  value={editing.intervalo_min_comando_s}
                  onChange={(e) => setEditing({ ...editing, intervalo_min_comando_s: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Agregação de temperatura</Label>
                <Select
                  value={editing.agregacao}
                  onValueChange={(v) => setEditing({ ...editing, agregacao: v as "media" | "maxima" })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="maxima">Máxima (mais conservador)</SelectItem>
                    <SelectItem value="media">Média</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3 rounded-md border px-3 py-2">
                <Switch
                  checked={editing.ativo}
                  onCheckedChange={(v) => setEditing({ ...editing, ativo: v })}
                />
                <Label className="cursor-pointer">Controle automático ativo</Label>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving}>
                <Save className="mr-1.5 h-4 w-4" />
                {saving ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
