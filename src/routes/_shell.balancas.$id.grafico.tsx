import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, RefreshCw, Scale, Thermometer } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  listarBalancas,
  listarHistoricoPeso,
  type Balanca,
  type HistoricoPeso,
} from "@/lib/balancas.functions";

export const Route = createFileRoute("/_shell/balancas/$id/grafico")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Gráfico de peso da balança — VitroCeres OS" },
      {
        name: "description",
        content:
          "Evolução do peso registrado pela balança, com temperatura e fases do ciclo.",
      },
      { property: "og:title", content: "Gráfico de peso da balança" },
      {
        property: "og:description",
        content: "Curva de peso por minuto, temperatura e fases do ciclo.",
      },
    ],
  }),
  component: GraficoPesoPage,
});

const PERIODOS = ["6h", "24h", "7d", "30d"] as const;
type Periodo = (typeof PERIODOS)[number];

const COR_FASE: Record<string, string> = {
  Injetando: "hsl(var(--primary) / 0.12)",
  Pausado: "hsl(var(--muted-foreground) / 0.12)",
  Retornando: "hsl(var(--chart-2, 200 80% 50%) / 0.12)",
  Alivio: "hsl(var(--muted-foreground) / 0.1)",
};

function GraficoPesoPage() {
  const { id } = useParams({ from: "/_shell/balancas/$id/grafico" });
  const listarHistorico = useServerFn(listarHistoricoPeso);
  const listar = useServerFn(listarBalancas);

  const [periodo, setPeriodo] = useState<Periodo>("24h");
  const [dados, setDados] = useState<HistoricoPeso | null>(null);
  const [balanca, setBalanca] = useState<Balanca | null>(null);
  const [mostrarTemp, setMostrarTemp] = useState(true);
  const [loading, setLoading] = useState(true);

  const carregar = async () => {
    setLoading(true);
    try {
      const [hist, todas] = await Promise.all([
        listarHistorico({ data: { balanca_id: id, periodo } }),
        listar(),
      ]);
      setDados(hist);
      setBalanca(todas.find((b) => b.id === id) ?? null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, periodo]);

  const grafico = useMemo(() => {
    if (!dados) return [];
    const porTs = new Map<
      number,
      { ts: number; peso?: number; temp?: number }
    >();
    for (const p of dados.pontos) {
      const ts = new Date(p.minuto).getTime();
      const item = porTs.get(ts) ?? { ts };
      item.peso = Number(p.valor_g.toFixed(2));
      porTs.set(ts, item);
    }
    if (mostrarTemp) {
      for (const p of dados.temperaturas) {
        const ts = new Date(p.minuto).getTime();
        const item = porTs.get(ts) ?? { ts };
        item.temp = Number(p.valor.toFixed(1));
        porTs.set(ts, item);
      }
    }
    return Array.from(porTs.values())
      .sort((a, b) => a.ts - b.ts)
      .map((p) => ({
        ...p,
        label: format(
          new Date(p.ts),
          periodo === "6h" || periodo === "24h" ? "HH:mm" : "dd/MM HH:mm",
        ),
      }));
  }, [dados, mostrarTemp, periodo]);

  const pesos = (dados?.pontos ?? []).map((p) => p.valor_g);
  const atual = pesos.length ? pesos[pesos.length - 1]! : null;
  const min = pesos.length ? Math.min(...pesos) : null;
  const max = pesos.length ? Math.max(...pesos) : null;
  const variacao =
    pesos.length > 1 ? pesos[pesos.length - 1]! - pesos[0]! : null;

  const labelPorTs = new Map(grafico.map((p) => [p.ts, p.label]));
  const labelMaisProximo = (iso: string) => {
    const alvo = new Date(iso).getTime();
    let melhor: { label: string; dist: number } | null = null;
    for (const [ts, label] of labelPorTs) {
      const dist = Math.abs(ts - alvo);
      if (!melhor || dist < melhor.dist) melhor = { label, dist };
    }
    return melhor?.label ?? null;
  };

  const fmt = (v: number | null, sufixo = " g") =>
    v == null ? "—" : `${v.toFixed(2)}${sufixo}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to="/balancas"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar para balanças
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold">
            <Scale className="h-6 w-6 text-primary" />
            {balanca?.nome ?? "Balança"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {dados?.bancada_nome
              ? `Prateleira ${dados.bancada_nome} · histórico por minuto`
              : "Sem prateleira associada · histórico por minuto"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
            <TabsList>
              {PERIODOS.map((p) => (
                <TabsTrigger key={p} value={p}>
                  {p}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {dados?.temperaturas.length ? (
            <Button
              size="sm"
              variant={mostrarTemp ? "secondary" : "outline"}
              onClick={() => setMostrarTemp((v) => !v)}
            >
              <Thermometer className="mr-1.5 h-4 w-4" />
              Temperatura
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={carregar} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { rotulo: "Peso atual", valor: fmt(atual) },
          { rotulo: "Mínimo", valor: fmt(min) },
          { rotulo: "Máximo", valor: fmt(max) },
          {
            rotulo: "Variação no período",
            valor:
              variacao == null
                ? "—"
                : `${variacao > 0 ? "+" : ""}${variacao.toFixed(2)} g`,
          },
        ].map((c) => (
          <Card key={c.rotulo}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{c.rotulo}</div>
              <div className="text-xl font-bold tabular-nums">{c.valor}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Evolução do peso</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-80 items-center justify-center text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : grafico.length === 0 ? (
            <div className="flex h-80 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <Scale className="h-10 w-10 text-muted-foreground/30" />
              <div className="font-medium text-foreground">
                Nenhum ponto neste período
              </div>
              <p className="max-w-sm">
                O histórico começa a ser gravado a partir das próximas leituras
                enviadas pela balança (uma média por minuto).
              </p>
            </div>
          ) : (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={grafico} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    minTickGap={24}
                  />
                  <YAxis
                    yAxisId="peso"
                    tick={{ fontSize: 11 }}
                    width={64}
                    unit=" g"
                    domain={["auto", "auto"]}
                  />
                  {mostrarTemp && dados?.temperaturas.length ? (
                    <YAxis
                      yAxisId="temp"
                      orientation="right"
                      tick={{ fontSize: 11 }}
                      width={48}
                      unit="°C"
                      domain={["auto", "auto"]}
                    />
                  ) : null}
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  {(dados?.fases ?? []).map((f, i) => {
                    const x1 = labelMaisProximo(f.inicio);
                    const x2 = labelMaisProximo(f.fim);
                    if (!x1 || !x2 || x1 === x2) return null;
                    return (
                      <ReferenceArea
                        key={`${f.inicio}-${i}`}
                        yAxisId="peso"
                        x1={x1}
                        x2={x2}
                        fill={COR_FASE[f.status] ?? "hsl(var(--muted) / 0.1)"}
                        strokeOpacity={0}
                      />
                    );
                  })}
                  <Line
                    yAxisId="peso"
                    type="monotone"
                    dataKey="peso"
                    name="Peso (g)"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  {mostrarTemp && dados?.temperaturas.length ? (
                    <Line
                      yAxisId="temp"
                      type="monotone"
                      dataKey="temp"
                      name="Temperatura (°C)"
                      stroke="hsl(0 72% 51%)"
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                    />
                  ) : null}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-4 rounded bg-primary" /> Peso
            </span>
            {mostrarTemp && dados?.temperaturas.length ? (
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-4 rounded"
                  style={{ background: "hsl(0 72% 51%)" }}
                />
                Temperatura da prateleira
              </span>
            ) : null}
            {dados?.fases.length ? (
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-4 rounded bg-primary/15" /> Fases do ciclo
                (injeção, pausa, retorno)
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
