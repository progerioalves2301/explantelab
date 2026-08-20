import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Scale, Plus, Trash2, Pencil, RefreshCw, LayoutGrid, KeyRound, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { listarBalancas, criarBalanca, editarBalanca, excluirBalanca, enviarComandoBalanca, type Balanca } from "@/lib/balancas.functions";
import { listBancadas } from "@/lib/bancadas.functions";
import type { Bancada } from "@/lib/types";

export const Route = createFileRoute("/_shell/balancas")({
  head: () => ({
    meta: [
      { title: "Gerenciamento de Balanças — VitroCeres OS" },
      { name: "description", content: "Configuração de balanças HX711 para pesagem autônoma." },
    ],
  }),
  component: BalancasPage,
});

const SEM_LAB = "__sem__";

function BalancasPage() {
  const getBalancas = useServerFn(listarBalancas);
  const getBancadas = useServerFn(listBancadas);
  const addBalanca = useServerFn(criarBalanca);
  const modBalanca = useServerFn(editarBalanca);
  const delBalanca = useServerFn(excluirBalanca);
  

  const [balancas, setBalancas] = useState<Balanca[]>([]);
  const [bancadas, setBancadas] = useState<Bancada[]>([]);
  const [loading, setLoading] = useState(true);
  const [openNova, setOpenNova] = useState(false);
  const [editing, setEditing] = useState<Balanca | null>(null);
  const [adjusting, setAdjusting] = useState<Balanca | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  const carregar = async () => {
    setLoading(true);
    try {
      const [b, bans] = await Promise.all([getBalancas(), getBancadas()]);
      setBalancas(b);
      setBancadas(bans);
    } catch (e) {
      toast.error("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void carregar(); }, []);

  const handleExcluir = async (id: string) => {
    try {
      await delBalanca({ data: { id } });
      toast.success("Balança excluída");
      setBalancas(prev => prev.filter(b => b.id !== id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir");
    }
  };


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Scale className="h-6 w-6 text-primary" />
            Gerenciamento de Balanças
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure e monitore as balanças HX711 integradas às prateleiras.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
            <RefreshCw className={cn("mr-1.5 h-4 w-4", loading && "animate-spin")} />
            Atualizar
          </Button>
          <Dialog open={openNova} onOpenChange={setOpenNova}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1.5 h-4 w-4" /> Nova balança
              </Button>
            </DialogTrigger>
            <NovaBalancaDialog
              bancadas={bancadas}
              onDone={() => { setOpenNova(false); carregar(); }}
              criar={addBalanca}
            />
          </Dialog>
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">Carregando balanças...</div>
      ) : balancas.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Scale className="mb-4 h-12 w-12 text-muted-foreground/30" />
            <div className="text-lg font-medium">Nenhuma balança cadastrada</div>
            <p className="mb-6 text-sm text-muted-foreground">
              Cadastre a primeira balança para começar a monitorar o peso das mudas.
            </p>
            <Button onClick={() => setOpenNova(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Cadastrar agora
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {balancas.map(b => (
            <Card key={b.id} className={cn("relative overflow-hidden", !b.ativa && "opacity-70")}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate">{b.nome}</CardTitle>
                    <CardDescription className="text-xs">
                      {bancadas.find(banc => banc.id === (b as any).bancada_associada_id)?.nome ?? "Sem prateleira"}
                    </CardDescription>
                  </div>
                  <Badge variant={b.ativa ? "secondary" : "outline"}>
                    {b.ativa ? "ativa" : "inativa"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-muted/50 p-2">
                    <div className="text-muted-foreground">Último peso</div>
                    <div className="text-lg font-bold tabular-nums">
                      {b.ultima_leitura_g != null ? `${b.ultima_leitura_g.toFixed(2)}g` : "—"}
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2">
                    <div className="text-muted-foreground">Sync</div>
                    <div className="text-[10px] font-medium mt-1">
                      {b.ultima_sync ? new Date(b.ultima_sync).toLocaleTimeString("pt-BR") : "Nunca"}
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5 text-[11px]">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <LayoutGrid className="h-3 w-3" /> Sala:
                    </span>
                    <span className="font-medium truncate ml-2 max-w-[120px]">
                      {(() => {
                        const bancada = bancadas.find(bans => bans.id === (b as any).bancada_associada_id);
                        return bancada ? "Associada" : "Não associada";
                      })()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <KeyRound className="h-3 w-3" /> Conexão:
                    </span>
                    <span className="font-medium">{b.paired_at ? "Ativa" : "Aguardando prateleira"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Estabilização:</span>
                    <span>{b.minutos_estabilizacao} min</span>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">

                  <Button size="sm" variant="outline" className="flex-1" onClick={() => setEditing(b)}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" /> Editar
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => setAdjusting(b)}>
                    <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Ajustes
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir balança?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Isso removerá a configuração da balança <strong>{b.nome}</strong>. O histórico de pesagens já gravado nas mudas será mantido.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleExcluir(b.id)} className="bg-destructive text-destructive-foreground">
                          Excluir
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={v => !v && setEditing(null)}>
        {editing && (
          <EditarBalancaDialog
            balanca={editing}
            bancadas={bancadas}
            onDone={() => { setEditing(null); carregar(); }}
            editar={modBalanca}
          />
        )}
      </Dialog>
      <Dialog open={!!adjusting} onOpenChange={v => !v && setAdjusting(null)}>
        {adjusting && (
          <AjustesBalancaDialog
            balanca={adjusting}
            onDone={() => setAdjusting(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

function AjustesBalancaDialog({ balanca, onDone }: { balanca: Balanca, onDone: () => void }) {
  const comandar = useServerFn(enviarComandoBalanca);
  const modBalanca = useServerFn(editarBalanca);
  
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [leitura, setLeitura] = useState<number | null>(balanca.ultima_leitura_g);
  const [fator, setFator] = useState(balanca.fator_calibracao.toString());

  const handleTara = async () => {
    setLoading(true);
    try {
      await comandar({
        data: {
          balanca_id: balanca.id,
          tipo: "BALANCA_TARA"
        }
      });
      toast.success("Comando de TARA enviado");
    } catch (e) {
      toast.error("Erro ao enviar comando");
    } finally {
      setLoading(false);
    }
  };

  const handleCalibrar = async () => {
    if (!fator || isNaN(Number(fator))) return toast.error("Fator inválido");
    setLoading(true);
    try {
      // 1. Salva no banco
      await modBalanca({
        data: {
          id: balanca.id,
          fator_calibracao: Number(fator)
        } as any
      });
      // 2. Envia para o dispositivo
      await comandar({
        data: {
          balanca_id: balanca.id,
          tipo: "BALANCA_CALIBRAR",
          payload: { fator: Number(fator) }
        }
      });
      toast.success("Fator de calibração atualizado e enviado");
    } catch (e) {
      toast.error("Erro ao atualizar calibração");
    } finally {
      setLoading(false);
    }
  };

  const atualizarLeitura = async () => {
    setReading(true);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("balancas")
        .select("ultima_leitura_g")
        .eq("id", balanca.id)
        .single();
      if (data) setLeitura(data.ultima_leitura_g);
    } finally {
      setReading(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-primary" />
          Ajustes da Balança
        </DialogTitle>
      </DialogHeader>
      
      <div className="space-y-6 pt-4">
        {/* Teste de Peso */}
        <div className="rounded-lg border bg-muted/40 p-4">
          <div className="mb-2 flex items-center justify-between">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Peso em tempo real
            </Label>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={atualizarLeitura} disabled={reading}>
              <RefreshCw className={cn("h-3 w-3", reading && "animate-spin")} />
            </Button>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-3xl font-bold">
              {leitura != null ? leitura.toFixed(2) : "—"}
            </span>
            <span className="text-sm font-medium text-muted-foreground">g</span>
          </div>
        </div>

        {/* Comandos Rápidos */}
        <div className="space-y-2">
          <Label>Manutenção</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-20 flex-col gap-2" onClick={handleTara} disabled={loading}>
              <Scale className="h-5 w-5" />
              <span>Tara (Zerar)</span>
            </Button>
            <Button variant="outline" className="h-20 flex-col gap-2" onClick={atualizarLeitura} disabled={loading || reading}>
              <RefreshCw className="h-5 w-5" />
              <span>Testar</span>
            </Button>
          </div>
        </div>

        {/* Calibração */}
        <div className="space-y-3 rounded-lg border p-4">
          <div className="space-y-1">
            <Label>Fator de Calibração</Label>
            <p className="text-[10px] text-muted-foreground">
              Ajuste o ganho do sensor. Valores comuns entre 100 e 5000.
            </p>
          </div>
          <div className="flex gap-2">
            <Input 
              type="number" 
              value={fator} 
              onChange={e => setFator(e.target.value)}
              className="font-mono"
            />
            <Button onClick={handleCalibrar} disabled={loading}>
              Salvar
            </Button>
          </div>
        </div>
      </div>

      <DialogFooter className="pt-4 border-t">
        <Button variant="ghost" onClick={onDone}>Fechar</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function NovaBalancaDialog({ bancadas, onDone, criar }: { bancadas: Bancada[], onDone: () => void, criar: any }) {
  const [nome, setNome] = useState("");
  const [bancadaId, setBancadaId] = useState(SEM_LAB);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [estabilizacao, setEstabilizacao] = useState("5");
  const [outlier, setOutlier] = useState("10.0");
  const [saving, setSaving] = useState(false);

  const handleSalvar = async () => {
    if (!nome.trim()) return toast.error("Informe o nome");
    setSaving(true);
    try {
      const result = await criar({
        data: {
          nome: nome.trim(),
          bancada_associada_id: bancadaId === SEM_LAB ? null : bancadaId,
          minutos_estabilizacao: Number(estabilizacao),
          outlier_delta_g: Number(outlier),
        }
      });
      setPairingCode(result.pairing_code);
      toast.success("Balança cadastrada; use o código para parear");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao cadastrar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Nova balança</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 pt-4">
        <div className="space-y-2">
          <Label>Nome da Balança *</Label>
          <Input placeholder="Ex: Balança P8S12, Prateleira 01..." value={nome} onChange={e => setNome(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Prateleira Associada (Opcional)</Label>
          <Select value={bancadaId} onValueChange={setBancadaId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_LAB}>Nenhuma</SelectItem>
              {bancadas.map(b => <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Estabilização (min)</Label>
            <Input type="number" value={estabilizacao} onChange={e => setEstabilizacao(e.target.value)} />
            <p className="text-[10px] text-muted-foreground">Espera pós-ciclo hidráulico.</p>
          </div>
          <div className="space-y-2">
            <Label>Filtro Outlier (g)</Label>
            <Input type="number" step="0.1" value={outlier} onChange={e => setOutlier(e.target.value)} />
            <p className="text-[10px] text-muted-foreground">Delta máximo entre leituras.</p>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Não há código separado: ao associar a balança a uma prateleira já pareada, o ESP32 dela passa a enviar o peso automaticamente.
        </p>
      </div>
      <DialogFooter className="mt-6">
        <Button variant="outline" onClick={onDone} disabled={saving}>Cancelar</Button>
        <Button onClick={handleSalvar} disabled={saving}>
          {saving ? "Salvando..." : "Cadastrar"}
        </Button>
      </DialogFooter>

    </DialogContent>
  );
}

function EditarBalancaDialog({ balanca, bancadas, onDone, editar }: { balanca: Balanca, bancadas: Bancada[], onDone: () => void, editar: any }) {
  const [nome, setNome] = useState(balanca.nome);
  const [bancadaId, setBancadaId] = useState((balanca as any).bancada_associada_id ?? SEM_LAB);
  const [ativa, setAtiva] = useState(balanca.ativa);
  const [estabilizacao, setEstabilizacao] = useState(balanca.minutos_estabilizacao.toString());
  const [outlier, setOutlier] = useState(balanca.outlier_delta_g.toString());
  const [saving, setSaving] = useState(false);

  const handleSalvar = async () => {
    setSaving(true);
    try {
      await editar({
        data: {
          id: balanca.id,
          nome: nome.trim(),
          bancada_associada_id: bancadaId === SEM_LAB ? null : bancadaId,
          ativa,
          minutos_estabilizacao: Number(estabilizacao),
          outlier_delta_g: Number(outlier),
        }
      });
      toast.success("Balança atualizada");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Editar balança</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 pt-4">
        <div className="space-y-2">
          <Label>Nome</Label>
          <Input value={nome} onChange={e => setNome(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Prateleira Associada (Opcional)</Label>
          <Select value={bancadaId} onValueChange={setBancadaId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_LAB}>Nenhuma</SelectItem>
              {bancadas.map(b => <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            A balança usará os eventos de ciclo desta prateleira para calcular o resíduo.
          </p>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <Label>Balança Ativa</Label>
          <Switch checked={ativa} onCheckedChange={setAtiva} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Estabilização (min)</Label>
            <Input type="number" value={estabilizacao} onChange={e => setEstabilizacao(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Filtro Outlier (g)</Label>
            <Input type="number" step="0.1" value={outlier} onChange={e => setOutlier(e.target.value)} />
          </div>
        </div>
      </div>
      <DialogFooter className="mt-6">
        <Button variant="outline" onClick={onDone} disabled={saving}>Cancelar</Button>
        <Button onClick={handleSalvar} disabled={saving}>
          {saving ? "Salvando..." : "Salvar alterações"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
