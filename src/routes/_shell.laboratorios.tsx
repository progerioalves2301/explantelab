import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FlaskConical, Plus, Trash2, Pencil, Check, X } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import {
  atualizarLaboratorio,
  criarLaboratorio,
  excluirLaboratorio,
} from "@/lib/laboratorios.functions";
import type { Bancada, Laboratorio } from "@/lib/types";

function sortLaboratorios(items: Laboratorio[]) {
  return items
    .slice()
    .sort(
      (a, b) =>
        a.ordem - b.ordem ||
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
}

function upsertLaboratorio(items: Laboratorio[], row: Laboratorio) {
  const idx = items.findIndex((l) => l.id === row.id);
  if (idx === -1) return sortLaboratorios([...items, row]);
  const copy = items.slice();
  copy[idx] = row;
  return sortLaboratorios(copy);
}

export const Route = createFileRoute("/_shell/laboratorios")({
  head: () => ({
    meta: [
      { title: "Laboratórios — GeneLab IoT" },
      {
        name: "description",
        content:
          "Gestão das salas de laboratório e agrupamento das bancadas ESP32.",
      },
    ],
  }),
  component: LaboratoriosPage,
});

function LaboratoriosPage() {
  const [labs, setLabs] = useState<Laboratorio[]>([]);
  const [bancadas, setBancadas] = useState<Bancada[]>([]);
  const [loading, setLoading] = useState(true);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [cor, setCor] = useState("#22c55e");
  const [saving, setSaving] = useState(false);
  const criar = useServerFn(criarLaboratorio);

  useEffect(() => {
    let alive = true;
    const refetch = async () => {
      const [labsRes, bancadasRes] = await Promise.all([
        supabase
          .from("laboratorios")
          .select("*")
          .order("ordem", { ascending: true }),
        supabase.from("bancadas").select("*"),
      ]);
      if (!alive) return;
      setLabs((labsRes.data ?? []) as unknown as Laboratorio[]);
      setBancadas((bancadasRes.data ?? []) as unknown as Bancada[]);
      setLoading(false);
    };

    void refetch();

    const ch = supabase
      .channel("laboratorios-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "laboratorios" },
        (payload) => {
          setLabs((prev) => {
            if (payload.eventType === "DELETE") {
              const deletedId = (payload.old as Partial<Laboratorio>).id;
              if (!deletedId) {
                void refetch();
                return prev;
              }
              return prev.filter(
                (l) => l.id !== deletedId,
              );
            }
            const row = payload.new as unknown as Laboratorio;
            return upsertLaboratorio(prev, row);
          });
        },
      )
      .subscribe();

    const timer = window.setInterval(refetch, 5_000);

    return () => {
      alive = false;
      window.clearInterval(timer);
      supabase.removeChannel(ch);
    };
  }, []);

  const handleCriar = async (e: React.FormEvent) => {
    e.preventDefault();
    const nomeTrim = nome.trim();
    if (nomeTrim.length < 2) {
      toast.error("Nome deve ter pelo menos 2 caracteres");
      return;
    }
    setSaving(true);
    try {
      const created = await criar({
        data: {
          nome: nomeTrim,
          descricao: descricao || undefined,
          cor,
          ordem: labs.length,
        },
      });
      setLabs((prev) => upsertLaboratorio(prev, created as Laboratorio));
      setNome("");
      setDescricao("");
      setCor("#22c55e");
      toast.success("Laboratório criado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Laboratórios</h1>
        <p className="text-sm text-muted-foreground">
          Agrupe as bancadas por sala. Sugerimos até 8 bancadas por laboratório.
        </p>
      </div>

      <Card className="card-elevated">
        <CardHeader>
          <CardTitle className="text-base">Novo laboratório</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleCriar}
            className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]"
          >
            <div className="grid gap-1.5">
              <Label htmlFor="nome" className="text-xs">
                Nome
              </Label>
              <Input
                id="nome"
                placeholder="Lab 1 — Cultivo A"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                minLength={2}
                maxLength={60}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="descricao" className="text-xs">
                Descrição
              </Label>
              <Input
                id="descricao"
                placeholder="Sala refrigerada, 8 bancadas"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cor" className="text-xs">
                Cor
              </Label>
              <Input
                id="cor"
                type="color"
                value={cor}
                onChange={(e) => setCor(e.target.value)}
                className="h-9 w-14 cursor-pointer p-1"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={saving}>
                <Plus className="mr-1 h-4 w-4" />
                {saving ? "Criando…" : "Criar"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : labs.length === 0 ? (
        <Card className="card-elevated">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <FlaskConical className="h-8 w-8 text-muted-foreground" />
            <div className="font-semibold">Nenhum laboratório cadastrado</div>
            <p className="text-sm text-muted-foreground">
              Crie a primeira sala acima. Depois vincule as bancadas.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {labs.map((lab) => (
            <LabRow
              key={lab.id}
              lab={lab}
              count={bancadas.filter((b) => b.laboratorio_id === lab.id).length}
              onDeleted={(id) =>
                setLabs((prev) => prev.filter((l) => l.id !== id))
              }
              onRestore={(removedLab) =>
                setLabs((prev) => upsertLaboratorio(prev, removedLab))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LabRow({
  lab,
  count,
  onDeleted,
  onRestore,
}: {
  lab: Laboratorio;
  count: number;
  onDeleted: (id: string) => void;
  onRestore: (lab: Laboratorio) => void;
}) {
  const atualizar = useServerFn(atualizarLaboratorio);
  const excluir = useServerFn(excluirLaboratorio);
  const [editing, setEditing] = useState(false);
  const [nome, setNome] = useState(lab.nome);
  const [descricao, setDescricao] = useState(lab.descricao ?? "");
  const [cor, setCor] = useState(lab.cor);

  const save = async () => {
    try {
      await atualizar({
        data: { id: lab.id, nome, descricao: descricao || null, cor },
      });
      toast.success("Salvo");
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    }
  };

  const remove = async () => {
    onDeleted(lab.id);
    try {
      await excluir({ data: { id: lab.id } });
      toast.success(`${lab.nome} removido`);
    } catch (e) {
      const { data } = await supabase
        .from("laboratorios")
        .select("id")
        .eq("id", lab.id)
        .maybeSingle();
      if (data) onRestore(lab);
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
    }
  };

  return (
    <Card className="card-elevated overflow-hidden" data-lab-id={lab.id}>
      <div className="h-1.5 w-full" style={{ background: lab.cor }} />
      <CardContent className="space-y-3 p-4">
        {editing ? (
          <div className="space-y-2">
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome"
            />
            <Input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Descrição"
            />
            <Input
              type="color"
              value={cor}
              onChange={(e) => setCor(e.target.value)}
              className="h-9 w-14 cursor-pointer p-1"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={save}>
                <Check className="mr-1 h-3.5 w-3.5" /> Salvar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setNome(lab.nome);
                  setDescricao(lab.descricao ?? "");
                  setCor(lab.cor);
                }}
              >
                <X className="mr-1 h-3.5 w-3.5" /> Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold">
                  {lab.nome}
                </div>
                {lab.descricao && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {lab.descricao}
                  </p>
                )}
              </div>
              <span
                className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                style={{ borderColor: lab.cor, color: lab.cor }}
              >
                {count} {count === 1 ? "bancada" : "bancadas"}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => setEditing(true)}
              >
                <Pencil className="mr-1 h-3.5 w-3.5" />
                Editar
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Excluir"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir {lab.nome}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      As bancadas vinculadas ficarão sem laboratório (não serão
                      apagadas). Você pode reatribuí-las depois.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={remove}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Excluir
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
