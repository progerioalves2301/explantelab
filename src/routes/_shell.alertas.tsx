import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, BellOff, CheckCircle2, Loader2, Send, Thermometer, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listarAlertas, resolverAlerta, type Alerta } from "@/lib/alertas.functions";

export const Route = createFileRoute("/_shell/alertas")({
  head: () => ({
    meta: [{ title: "Alertas — Explante Lab" }],
  }),
  component: AlertasPage,
});

function tipoIcon(tipo: string) {
  if (tipo === "offline") return <WifiOff className="h-4 w-4" />;
  if (tipo === "temperatura") return <Thermometer className="h-4 w-4" />;
  return <AlertTriangle className="h-4 w-4" />;
}

function AlertasPage() {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<"abertos" | "todos">("abertos");
  const listar = useServerFn(listarAlertas);
  const resolver = useServerFn(resolverAlerta);

  const carregar = async () => {
    try {
      const data = await listar();
      setAlertas(data);
    } catch (e) {
      toast.error("Falha ao carregar alertas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 15000);
    return () => clearInterval(t);
  }, []);

  const handleResolver = async (id: string) => {
    try {
      await resolver({ data: { id } });
      toast.success("Alerta resolvido");
      carregar();
    } catch (e) {
      toast.error("Falha ao resolver");
    }
  };

  const visiveis = alertas.filter((a) =>
    filtro === "abertos" ? !a.resolvido_em : true,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold text-primary">Alertas</h1>
          <p className="text-sm text-muted-foreground">
            Monitoramento contínuo de bancadas offline, temperatura e ciclos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={filtro === "abertos" ? "default" : "outline"} size="sm" onClick={() => setFiltro("abertos")}>
            Abertos
          </Button>
          <Button variant={filtro === "todos" ? "default" : "outline"} size="sm" onClick={() => setFiltro("todos")}>
            Todos
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/alertas/destinos"><Send className="mr-1.5 h-4 w-4" />Destinos Telegram</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {visiveis.length} alerta{visiveis.length === 1 ? "" : "s"} {filtro === "abertos" ? "aberto(s)" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : visiveis.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <BellOff className="h-8 w-8" />
              <p className="text-sm">Nenhum alerta {filtro === "abertos" ? "aberto" : ""} no momento.</p>
            </div>
          ) : (
            visiveis.map((a) => (
              <div
                key={a.id}
                className={`flex items-start gap-3 rounded-md border p-3 ${a.resolvido_em ? "opacity-60" : ""}`}
              >
                <div className={`mt-0.5 rounded-md p-1.5 ${a.severidade === "critical" ? "bg-destructive/10 text-destructive" : "bg-yellow-500/10 text-yellow-600"}`}>
                  {tipoIcon(a.tipo)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{a.bancada_nome ?? "Bancada"}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">{a.tipo}</Badge>
                    <Badge variant={a.severidade === "critical" ? "destructive" : "secondary"} className="text-[10px]">
                      {a.severidade}
                    </Badge>
                    {a.resolvido_em && <Badge variant="outline" className="text-[10px]"><CheckCircle2 className="mr-1 h-3 w-3" />resolvido</Badge>}
                  </div>
                  <p className="mt-1 text-sm">{a.mensagem}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {new Date(a.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>
                {!a.resolvido_em && (
                  <Button size="sm" variant="ghost" onClick={() => handleResolver(a.id)}>
                    Resolver
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
