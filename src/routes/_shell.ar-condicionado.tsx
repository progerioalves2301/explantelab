import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AirVent, Plus, Power, Radio, Save, Trash2, Wind } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  ressincronizarArCondicionado,
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
  histerese: number;
  intervalo_min_comando_s: number;
  permanencia_min_s: number;

  agregacao: "media" | "maxima" | "controladora";
  suporta_aquecimento: boolean;
};

// Espelha o piso aplicado em decidir_ar_condicionado(): nunca menos de 60 s.
function proximaJanela(ar: ArCondicionado): string {
  if (!ar.ultimo_comando_em) return "agora";
  const espera = Math.max(ar.intervalo_min_comando_s, 60) * 1000;
  const alvo = new Date(ar.ultimo_comando_em).getTime() + espera;
  const faltam = Math.ceil((alvo - Date.now()) / 1000);
  if (faltam <= 0) return "agora";
  return faltam >= 60
    ? `em ${Math.ceil(faltam / 60)} min`
    : `em ${faltam}s`;
}

function emptyForm(labs: Laboratorio[]): FormState {
  return {
    id: null,
    laboratorio_id: labs[0]?.id ?? "",
    bancada_controladora_id: null,
    marca: "LG",
    modelo: "",
    ir_protocol: "RAW",
    ativo: true,
    histerese: 1,
    intervalo_min_comando_s: 180,
    permanencia_min_s: 600,

    agregacao: "maxima",
    suporta_aquecimento: false,
  };
}

function ArCondicionadoPage() {
  const listAr = useServerFn(listArCondicionados);
  const listLabs = useServerFn(listLaboratorios);
  const listB = useServerFn(listBancadas);
  const salvar = useServerFn(salvarArCondicionado);
  const excluir = useServerFn(excluirArCondicionado);
  const testar = useServerFn(testarArCondicionado);
  const ressincronizar = useServerFn(ressincronizarArCondicionado);
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

  // Só prateleiras declaradas como emissoras de IR podem controlar o ar.
  // Prateleiras antigas (sem perfil declarado) continuam elegíveis.
  const bancadasDaSala = (labId: string) =>
    bancadas.filter(
      (b) =>
        b.laboratorio_id === labId &&
        (b.controla_ar == null || b.controla_ar === true),
    );

  const startNew = () => {
    if (labs.length === 0) {
      toast.error("Cadastre uma sala primeiro");
      return;
    }
    setEditing({ ...emptyForm(labs), laboratorio_id: labs[0].id });
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
      histerese: Number(ar.histerese),
      intervalo_min_comando_s: ar.intervalo_min_comando_s,
      permanencia_min_s: ar.permanencia_min_s ?? 600,

      agregacao: ar.agregacao,
      suporta_aquecimento: ar.suporta_aquecimento,
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.laboratorio_id) return toast.error("Escolha uma sala");
    if (!editing.bancada_controladora_id)
      return toast.error("Escolha a prateleira que vai controlar o ar (emissor IR no GPIO 32)");
    // Faixa vem da prateleira controladora — não valida setpoints aqui.
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
            | "RAW"
            | "LG"
            | "SAMSUNG"
            | "FUJITSU"
            | "MIDEA"
            | "ELECTROLUX"
            | "ELGIN"
            | "ELECTRA"
            | "CONSUL",
          ativo: editing.ativo,
          setpoint_min: editing.setpoint_min,
          setpoint_max: editing.setpoint_max,
          histerese: editing.histerese,
          intervalo_min_comando_s: editing.intervalo_min_comando_s,
          agregacao: editing.agregacao,
          suporta_aquecimento: editing.suporta_aquecimento,
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
    try {
      await excluir({ data: { id } });
      toast.success("Removido");
      await reload();
    } catch (e) {
      toast.error("Falha", { description: String(e) });
    }
  };

  const handleRessincronizar = async (id: string) => {
    setTestingId(id);
    try {
      const r = await ressincronizar({ data: { id } });
      toast.success(
        `Estado reenviado ao aparelho (${r.acao === "on" ? "LIGADO" : "DESLIGADO"})`,
      );
      await reload();
    } catch (e) {
      toast.error("Falha ao ressincronizar", { description: String(e) });
    } finally {
      setTestingId(null);
    }
  };

  const handleTestar = async (id: string, acao: "on" | "off", modo: "cool" | "heat" = "cool") => {
    setTestingId(id);
    try {
      await testar({ data: { id, acao, modo } });
      toast.success(
        `Comando ${acao === "on" ? "LIGAR" : "DESLIGAR"} (${modo === "heat" ? "quente" : "frio"}) enviado`,
      );
      await reload();
    } catch (e) {
      toast.error("Falha ao testar", { description: String(e) });
    } finally {
      setTestingId(null);
    }
  };

  const handleAprender = async (
    id: string,
    modo: "cool" | "heat" | "off" = "cool",
  ) => {
    setTestingId(id);
    const toastId = `aprender-${id}-${modo}`;
    // Guarda o estado inicial pra detectar quando um novo código chegar.
    const arAntes = ars.find((a) => a.id === id);
    const campo =
      modo === "heat"
        ? "codigo_ir_raw_heat"
        : modo === "off"
          ? "codigo_ir_raw_off"
          : "codigo_ir_raw";
    const rotulo =
      modo === "heat" ? "quente" : modo === "off" ? "desligar" : "frio";
    const tamanhoAntes = arAntes?.[campo]?.length ?? 0;
    try {
      const r = await aprender({ data: { id, timeout_s: 30, modo } });
      const total = r.timeout_s;
      const t0 = Date.now();
      toast.loading(
        `Aguardando sinal do controle (${rotulo})…`,
        {
          id: toastId,
          description: `Aponte o controle para o receptor e aperte ${modo === "off" ? "DESLIGAR" : modo === "heat" ? "LIGAR modo quente" : "LIGAR modo frio"}. Restam ${total}s.`,
          duration: (total + 5) * 1000,
        },
      );

      // Poll a cada 1.5s até detectar novo código ou estourar o timeout.
      let capturado: { pulsos: number } | null = null;
      let ultimoDebugEm: string | null = arAntes?.ir_learn_debug?.em ?? null;
      while (Date.now() - t0 < total * 1000) {
        await new Promise((res) => setTimeout(res, 1500));
        try {
          const lista = await listAr();
          const atual = lista.find((a) => a.id === id);
          const tamanhoAgora = atual?.[campo]?.length ?? 0;
          const restante = Math.max(
            0,
            Math.ceil(total - (Date.now() - t0) / 1000),
          );
          if (tamanhoAgora > 0 && tamanhoAgora !== tamanhoAntes) {
            capturado = { pulsos: tamanhoAgora };
            setArs(lista);
            break;
          }
          // v2.4.3 — reflete evento reportado pelo firmware em tempo real
          const dbg = atual?.ir_learn_debug;
          let statusLinha = "Aponte o controle para o receptor e aperte LIGAR.";
          if (dbg && dbg.em !== ultimoDebugEm) {
            ultimoDebugEm = dbg.em;
          }
          if (dbg) {
            if (dbg.evento === "iniciado") {
              statusLinha = "Receptor IR ativo, esperando comando do controle…";
            } else if (dbg.evento === "curto") {
              statusLinha = `Recebi um sinal de ${dbg.pulsos} pulsos, mas foi curto demais. Aperte de novo, mais próximo do sensor.`;
            } else if (dbg.evento === "falha_gravar") {
              statusLinha = `Sinal recebido (${dbg.pulsos} pulsos), mas falhou ao gravar. Nova tentativa em andamento…`;
            } else if (dbg.evento === "timeout") {
              statusLinha = "Timeout: nenhum sinal chegou ao receptor.";
            }
          }
          toast.loading(
            `Aguardando sinal do controle (${rotulo})…`,
            {
              id: toastId,
              description: `${statusLinha} Restam ${restante}s.`,
            },
          );
        } catch {
          // ignora falha de poll pontual
        }
      }

      if (capturado) {
        toast.success(
          `Sinal IR ${rotulo} capturado!`,
          {
            id: toastId,
            description: `${capturado.pulsos} pulsos recebidos e gravados. Use "Testar" para confirmar que o ar responde.`,
          },
        );
      } else {
        // Puxa uma última vez pra dar um motivo específico se o firmware reportou algo.
        let motivo = "Verifique se o receptor VS1838B está no GPIO 33, se a prateleira controladora está online e mire o controle direto no sensor.";
        try {
          const lista = await listAr();
          const dbg = lista.find((a) => a.id === id)?.ir_learn_debug;
          if (dbg?.evento === "curto") {
            motivo = `Recebi ${dbg.pulsos} pulsos, mas o frame ficou curto demais para um comando de ar. Mire mais próximo do sensor e aperte novamente.`;
          } else if (dbg?.evento === "iniciado") {
            motivo = "O receptor iniciou, mas nenhum pulso chegou. Confira alimentação 3.3V do VS1838B, GND comum, e se o LED do controle está funcionando (dá pra ver o LED IR pela câmera do celular).";
          } else if (dbg?.evento === "falha_gravar") {
            motivo = "O firmware recebeu o sinal, mas falhou ao enviar pro backend. Verifique a internet da prateleira e tente de novo.";
          }
        } catch { /* ignore */ }
        toast.error("Nenhum sinal IR gravado", {
          id: toastId,
          description: motivo,
        });
      }
      await reload();
    } catch (e) {
      toast.error("Falha ao iniciar aprendizado IR", {
        id: toastId,
        description: String(e),
      });
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
          <div className="mt-4 grid gap-2 rounded-md border bg-muted/50 p-4 text-xs text-muted-foreground shadow-sm max-w-2xl">
            <h3 className="font-semibold text-foreground mb-1">Entenda o funcionamento do controle automático:</h3>
            <ul className="space-y-1.5 list-disc list-inside">
              <li><strong>Histerese:</strong> Margem de tolerância aplicada sobre os limites da prateleira. Se o limite máximo for 25°C, o ar liga para esfriar e só desliga quando a temperatura cair para 24°C (considerando 1°C de histerese), evitando ciclos curtos que desgastam o compressor.</li>
              <li><strong>Intervalo mín entre cmds:</strong> Tempo de segurança que o sistema aguarda antes de enviar um novo comando IR (ex.: trocar de Frio para Quente ou Desligar), protegendo o compressor do aparelho.</li>
              <li><strong>Agregação de temperatura:</strong> Como o sistema decide a temperatura da sala se houver várias prateleiras com sensores. <strong>Média</strong> usa o valor equilibrado; <strong>Máxima</strong> liga o ar baseando-se no ponto mais quente da sala (recomendado para maior segurança das plantas).</li>
              <li><strong>Controle automático ativo:</strong> Quando ligado, o sistema monitora a temperatura em tempo real e envia comandos IR via prateleira controladora para manter o ambiente dentro da faixa ideal definida na configuração de cada prateleira.</li>
            </ul>
          </div>
        </div>
        <Button onClick={startNew} disabled={labs.length === 0}>
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
                      ? ar.modo_atual === "heat"
                        ? "bg-orange-500/15 text-orange-700 dark:text-orange-400"
                        : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {ar.ligado
                    ? `${ar.modo_atual === "heat" ? "QUENTE" : "FRIO"} ${ar.setpoint_atual ?? "-"}°C`
                    : "DESLIGADO"}
                </span>
                {!ar.ativo && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                    INATIVO
                  </span>
                )}
                {ar.suporta_aquecimento && (
                  <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold text-orange-700 dark:text-orange-400">
                    QUENTE/FRIO
                  </span>
                )}
                {ar.codigo_ir_raw && ar.codigo_ir_raw.length > 0 && (
                  <span
                    className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-400"
                    title={`${ar.codigo_ir_raw.length} pulsos (frio)`}
                  >
                    IR ON
                  </span>
                )}
                {ar.codigo_ir_raw_off && ar.codigo_ir_raw_off.length > 0 && (
                  <span
                    className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:text-slate-300"
                    title={`${ar.codigo_ir_raw_off.length} pulsos (desligar)`}
                  >
                    IR OFF
                  </span>
                )}
                {ar.codigo_ir_raw_heat && ar.codigo_ir_raw_heat.length > 0 && (
                  <span
                    className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold text-orange-700 dark:text-orange-400"
                    title={`${ar.codigo_ir_raw_heat.length} pulsos (quente)`}
                  >
                    IR QUENTE
                  </span>
                )}
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testingId === ar.id}
                  onClick={() => handleAprender(ar.id, "cool")}
                  title="Aprender código de LIGAR (frio)"
                >
                  <Radio className="mr-1 h-3.5 w-3.5" />
                  IR ON
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testingId === ar.id}
                  onClick={() => handleAprender(ar.id, "off")}
                  title="Aprender código de DESLIGAR (aperte o botão de desligar do controle)"
                >
                  <Radio className="mr-1 h-3.5 w-3.5" />
                  IR OFF
                </Button>
                {ar.suporta_aquecimento && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={testingId === ar.id}
                    onClick={() => handleAprender(ar.id, "heat")}
                    title="Aprender código de LIGAR QUENTE"
                    className="border-orange-500/40"
                  >
                    <Radio className="mr-1 h-3.5 w-3.5" />
                    IR ON quente
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testingId === ar.id}
                  onClick={() => handleTestar(ar.id, "on", "cool")}
                >
                  <Power className="mr-1 h-3.5 w-3.5" />
                  Frio ON
                </Button>
                {ar.suporta_aquecimento && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={testingId === ar.id}
                    onClick={() => handleTestar(ar.id, "on", "heat")}
                    className="border-orange-500/40"
                  >
                    <Power className="mr-1 h-3.5 w-3.5" />
                    Quente ON
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testingId === ar.id}
                  onClick={() => handleTestar(ar.id, "off")}
                >
                  <Power className="mr-1 h-3.5 w-3.5" />
                  Frio OFF
                </Button>

                <Button size="sm" variant="ghost" onClick={() => startEdit(ar)}>
                  Editar
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Excluir ar-condicionado?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Deseja remover a configuração de ar-condicionado da sala <strong>{lab?.nome}</strong>?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleDelete(ar.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Excluir
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
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
                <div className="text-xs text-muted-foreground">Faixa (da prateleira)</div>
                <div>
                  {ctrl?.temp_min != null && ctrl?.temp_max != null
                    ? `${ctrl.temp_min}°C – ${ctrl.temp_max}°C`
                    : <span className="text-red-600">Configure na prateleira</span>}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Temp. de referência
                </div>
                <div>
                  {ar.ultimo_temp_lida != null
                    ? `${Number(ar.ultimo_temp_lida).toFixed(1)}°C`
                    : "—"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {ar.agregacao === "controladora"
                    ? `origem: prateleira ${ctrl?.nome ?? "controladora"}`
                    : ar.agregacao === "media"
                      ? "origem: média da sala"
                      : "origem: máxima da sala"}
                </div>
              </div>
              <div className="col-span-2 sm:col-span-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
                <span>
                  Último comando:{" "}
                  {ar.ultimo_comando_em
                    ? new Date(ar.ultimo_comando_em).toLocaleString("pt-BR")
                    : "—"}
                </span>
                <span>Próximo comando possível: {proximaJanela(ar)}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={testingId === ar.id}
                  onClick={() => handleRessincronizar(ar.id)}
                >
                  Ressincronizar estado
                </Button>
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
                    {labs.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.nome}
                      </SelectItem>
                    ))}
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
                        Nenhuma prateleira desta sala está marcada como
                        “Controla ar-condicionado”
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

            {(() => {
              const ctrl = bancadas.find((b) => b.id === editing.bancada_controladora_id);
              const temMin = ctrl?.temp_min != null;
              const temMax = ctrl?.temp_max != null;
              return (
                <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
                  <div className="text-xs font-semibold text-primary">
                    Faixa de temperatura (unificada com o alerta da prateleira)
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {ctrl ? (
                      temMin && temMax ? (
                        <>Ar liga em <b>frio</b> acima de <b>{ctrl.temp_max}°C</b> e em{" "}
                        <b>quente</b> abaixo de <b>{ctrl.temp_min}°C</b>. Para mudar, edite
                        a prateleira <b>{ctrl.nome}</b> (temp mín/máx).</>
                      ) : (
                        <span className="text-red-600">
                          A prateleira {ctrl.nome} está sem temp mín/máx — configure lá antes.
                        </span>
                      )
                    ) : (
                      <span>Escolha a prateleira controladora acima.</span>
                    )}
                  </div>
                </div>
              );
            })()}

            <div className="grid gap-2 sm:grid-cols-2">
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
                  onValueChange={(v) =>
                    setEditing({ ...editing, agregacao: v as FormState["agregacao"] })
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="controladora">
                      Somente a prateleira controladora
                    </SelectItem>
                    <SelectItem value="maxima">Máxima da sala (mais conservador)</SelectItem>
                    <SelectItem value="media">Média da sala</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Define qual temperatura liga/desliga o ar. Em "somente a
                  prateleira controladora", só o sensor dela conta.
                </p>
              </div>
              <div className="flex items-center gap-3 rounded-md border px-3 py-2">
                <Switch
                  checked={editing.ativo}
                  onCheckedChange={(v) => setEditing({ ...editing, ativo: v })}
                />
                <Label className="cursor-pointer">Controle automático ativo</Label>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-md border border-orange-500/30 bg-orange-500/5 px-3 py-2">
              <Switch
                checked={editing.suporta_aquecimento}
                onCheckedChange={(v) => setEditing({ ...editing, suporta_aquecimento: v })}
              />
              <div className="grid gap-0.5">
                <Label className="cursor-pointer">Este ar tem modo QUENTE (aquecimento)</Label>
                <p className="text-xs text-muted-foreground">
                  Marque nos ares quente/frio (ex.: Elgin HVFI30). Quando ligado, o sistema aquece
                  a sala se a temperatura cair abaixo do mínimo. Deixe desmarcado nos ares só-frio
                  (ex.: Springer 42AFVCI18). Cada modo tem seu próprio código IR aprendido.
                </p>
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
