import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, LineChart as LineChartIcon, RefreshCw } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  listarHistoricoTemperatura,
  type PeriodoGrafico,
  type PontoTemperatura,
} from "@/lib/medicoes.functions";
import { listBancadas } from "@/lib/bancadas.functions";
import type { Bancada } from "@/lib/types";

export const Route = createFileRoute("/_shell/bancadas/$id/grafico")({
  head: () => ({
    meta: [
      { title: "Gráfico de temperatura — VitroCeres OS" },
      {
        name: "description",
        content:
          "Histórico de temperatura da prateleira, com filtro por período.",
      },
    ],
  }),
  component: GraficoTemperaturaPage,
});

function GraficoTemperaturaPage() {
  const { id } = useParams({ from: "/_shell/bancadas/$id/grafico" });
  const listar = useServerFn(listarHistoricoTemperatura);
  const listB = useServerFn(listBancadas);

  const [pontos, setPontos] = useState<PontoTemperatura[]>([]);
  const [periodo, setPeriodo] = useState<PeriodoGrafico>("24h");
  const [loading, setLoading] = useState(true);
  const [bancada, setBancada] = useState<Bancada | null>(null);

  const carregar = async () => {
    setLoading(true);
    try {
      const [dados, bs] = await Promise.all([
        listar({ data: { bancada_id: id, periodo } }),
        listB(),
      ]);
      setPontos(dados);
      setBancada(bs.find((b) => b.id === id) ?? null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, periodo]);

  const tempMin = bancada?.temp_min ?? null;
  const tempMax = bancada?.temp_max ?? null;

  const valores = pontos.map((p) => p.valor);
  const min = valores.length ? Math.min(...valores) : null;
  const max = valores.length ? Math.max(...valores) : null;
  const media =
    valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null;

  const dadosGrafico = pontos.map((p) => ({
    ts: new Date(p.minuto).getTime(),
    label: format(new Date(p.minuto), periodo === "6h" || periodo === "24h" ? "HH:mm" : "dd/MM HH:mm"),
    valor: Number(p.valor),
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Voltar
            </Link>
          </div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold">
            <LineChartIcon className="h-6 w-6 text-primary" />
            Temperatura — {bancada?.nome ?? "…"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Histórico do sensor DS18B20 (1 ponto por minuto, retenção 90 dias).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <Tabs value={periodo} onValueChange={(v) => setPeriodo(v as PeriodoGrafico)}>
        <TabsList>
          <TabsTrigger value="6h">Últimas 6h</TabsTrigger>
          <TabsTrigger value="24h">Últimas 24h</TabsTrigger>
          <TabsTrigger value="7d">7 dias</TabsTrigger>
          <TabsTrigger value="30d">30 dias</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Pontos" value={pontos.length.toString()} />
        <StatCard
          label="Mínima"
          value={min != null ? `${min.toFixed(1)}°C` : "—"}
        />
        <StatCard
          label="Média"
          value={media != null ? `${media.toFixed(1)}°C` : "—"}
        />
        <StatCard
          label="Máxima"
          value={max != null ? `${max.toFixed(1)}°C` : "—"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Curva de temperatura ({periodo})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid h-[360px] place-items-center text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : pontos.length === 0 ? (
            <div className="grid h-[360px] place-items-center text-center text-sm text-muted-foreground">
              <div>
                <p>Nenhuma leitura registrada nesse período.</p>
                <p className="mt-1 text-xs">
                  O histórico começa a ser gravado a partir do momento em que a
                  prateleira envia telemetria com temperatura válida.
                </p>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <LineChart
                data={dadosGrafico}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="label"
                  minTickGap={40}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  domain={["dataMin - 1", "dataMax + 1"]}
                  tickFormatter={(v) => `${v}°`}
                  width={45}
                />
                <Tooltip
                  formatter={(v: number) => [`${v.toFixed(2)}°C`, "Temperatura"]}
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                {tempMin != null && (
                  <ReferenceLine
                    y={Number(tempMin)}
                    stroke="hsl(217 91% 60%)"
                    strokeDasharray="4 4"
                    label={{
                      value: `mín ${tempMin}°`,
                      fontSize: 10,
                      fill: "hsl(217 91% 60%)",
                      position: "insideBottomRight",
                    }}
                  />
                )}
                {tempMax != null && (
                  <ReferenceLine
                    y={Number(tempMax)}
                    stroke="hsl(0 84% 60%)"
                    strokeDasharray="4 4"
                    label={{
                      value: `máx ${tempMax}°`,
                      fontSize: 10,
                      fill: "hsl(0 84% 60%)",
                      position: "insideTopRight",
                    }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="valor"
                  name="Temperatura"
                  stroke="var(--fluid)"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={{ r: 4, fill: "var(--fluid)", stroke: "var(--card)", strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: "var(--fluid)", stroke: "var(--card)", strokeWidth: 2 }}
                  isAnimationActive={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
