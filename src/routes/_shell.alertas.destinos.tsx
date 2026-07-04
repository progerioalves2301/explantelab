import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  criarDestino,
  listarDestinos,
  removerDestino,
  testarDestino,
  toggleDestino,
  type AlertaDestino,
} from "@/lib/alertas.functions";

export const Route = createFileRoute("/_shell/alertas/destinos")({
  head: () => ({
    meta: [{ title: "Destinos Telegram — Explante Lab" }],
  }),
  component: DestinosPage,
});

function DestinosPage() {
  const [destinos, setDestinos] = useState<AlertaDestino[]>([]);
  const [loading, setLoading] = useState(true);
  const [nome, setNome] = useState("");
  const [chatId, setChatId] = useState("");
  const [saving, setSaving] = useState(false);

  const listar = useServerFn(listarDestinos);
  const criar = useServerFn(criarDestino);
  const toggle = useServerFn(toggleDestino);
  const remover = useServerFn(removerDestino);
  const testar = useServerFn(testarDestino);

  const carregar = async () => {
    try {
      setDestinos(await listar());
    } catch {
      toast.error("Falha ao carregar destinos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  const handleCriar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim() || !chatId.trim()) return;
    setSaving(true);
    try {
      await criar({ data: { nome: nome.trim(), chat_id: chatId.trim() } });
      toast.success("Destino adicionado");
      setNome(""); setChatId("");
      carregar();
    } catch (e: any) {
      toast.error("Falha ao adicionar", { description: String(e?.message ?? e) });
    } finally {
      setSaving(false);
    }
  };

  const handleTestar = async (d: AlertaDestino) => {
    try {
      await testar({ data: { chat_id: d.chat_id } });
      toast.success(`Mensagem de teste enviada para ${d.nome}`);
    } catch (e: any) {
      toast.error("Falha no teste", { description: String(e?.message ?? e) });
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold text-primary">Destinos Telegram</h1>
        <p className="text-sm text-muted-foreground">
          Chat IDs que recebem as notificações de alerta.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Como obter seu chat_id</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. No Telegram, abra <a className="text-primary underline" href="https://t.me/userinfobot" target="_blank" rel="noreferrer">@userinfobot</a> e envie qualquer mensagem — ele responderá com seu ID (ex: <code>123456789</code>).</p>
          <p>2. Envie <code>/start</code> para o bot da Explante Lab para que ele possa te mandar mensagens.</p>
          <p>3. Para grupos, adicione o bot ao grupo e use um bot como <a className="text-primary underline" href="https://t.me/RawDataBot" target="_blank" rel="noreferrer">@RawDataBot</a> para pegar o ID do chat (começa com <code>-100…</code>).</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Adicionar destino</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleCriar} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div>
              <Label className="text-xs">Nome</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: João (operador)" />
            </div>
            <div>
              <Label className="text-xs">Chat ID</Label>
              <Input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="123456789" />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="mr-1.5 h-4 w-4" />Adicionar</>}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Destinos configurados</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : destinos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum destino ainda.</p>
          ) : (
            destinos.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-md border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{d.nome}</span>
                    {!d.ativo && <Badge variant="outline" className="text-[10px]">inativo</Badge>}
                  </div>
                  <code className="text-[11px] text-muted-foreground">{d.chat_id}</code>
                </div>
                <Switch
                  checked={d.ativo}
                  onCheckedChange={async (v) => {
                    await toggle({ data: { id: d.id, ativo: v } });
                    carregar();
                  }}
                />
                <Button size="sm" variant="outline" onClick={() => handleTestar(d)}>
                  <Send className="mr-1.5 h-3.5 w-3.5" />Testar
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm(`Remover destino "${d.nome}"?`)) return;
                    await remover({ data: { id: d.id } });
                    toast.success("Destino removido");
                    carregar();
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
