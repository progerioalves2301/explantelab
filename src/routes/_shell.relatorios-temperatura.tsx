import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { jsPDF } from "jspdf";
import { useEffect, useMemo, useState } from "react";
import { Thermometer, FlaskConical, Loader2, FileText, ArrowLeft } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listarRelatorioTemperatura } from "@/lib/medicoes.functions";
import { listarMudasPeriodo, type MudaPeriodo } from "@/lib/mudas.functions";
import type { Bancada, Laboratorio } from "@/lib/types";

export const Route = createFileRoute("/_shell/relatorios-temperatura")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Relatório de Temperatura" },
      {
        name: "description",
        content:
          "Relatório de temperatura das prateleiras por período e sala bioreator.",
      },
    ],
  }),
  component: RelatorioTemperaturaPage,
});

const PERIODOS = {
  "24h": { label: "Últimas 24 horas", horas: 24 },
  "7d": { label: "Últimos 7 dias", horas: 24 * 7 },
  "30d": { label: "Últimos 30 dias", horas: 24 * 30 },
  "60d": { label: "Últimos 60 dias", horas: 24 * 60 },
  "90d": { label: "Últimos 90 dias", horas: 24 * 90 },
  "120d": { label: "Últimos 120 dias", horas: 24 * 120 },
} as const;

type PeriodoKey = keyof typeof PERIODOS;

type EstatBancada = {
  bancada: Bancada;
  n: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  foraFaixa: number;
  variedades: string[];
};

const TODAS_VARIEDADES = "__todas__";

function mudaAtivaEm(
  mudasDaBancada: MudaPeriodo[],
  ts: number,
): MudaPeriodo | null {
  for (const m of mudasDaBancada) {
    const ini = new Date(m.data_inicio).getTime();
    const fim = m.data_fim ? new Date(m.data_fim).getTime() : Infinity;
    if (ts >= ini && ts <= fim) return m;
  }
  return null;
}

function fmt(v: number | null, casas = 1) {
  if (v === null || !Number.isFinite(v)) return "—";
  return v.toFixed(casas);
}

function desenharGrafico(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  serie: { label: string; valor: number }[],
  refMin: number | null,
  refMax: number | null,
) {
  // Moldura
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.2);
  doc.rect(x, y, w, h);

  if (serie.length < 2) {
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text("Dados insuficientes para o gráfico.", x + 3, y + h / 2);
    doc.setTextColor(0, 0, 0);
    return;
  }

  const padL = 10;
  const padR = 4;
  const padT = 4;
  const padB = 10;
  const cx = x + padL;
  const cy = y + padT;
  const cw = w - padL - padR;
  const ch = h - padT - padB;

  const valores = serie.map((s) => s.valor);
  let vMin = Math.min(...valores, ...(refMin !== null ? [refMin] : []));
  let vMax = Math.max(...valores, ...(refMax !== null ? [refMax] : []));
  if (vMin === vMax) {
    vMin -= 1;
    vMax += 1;
  } else {
    const pad = (vMax - vMin) * 0.1;
    vMin -= pad;
    vMax += pad;
  }

  const xAt = (i: number) => cx + (i / (serie.length - 1)) * cw;
  const yAt = (v: number) => cy + ch - ((v - vMin) / (vMax - vMin)) * ch;

  // Grid horizontal + labels do eixo Y (3 divisões)
  doc.setDrawColor(235, 235, 235);
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  for (let i = 0; i <= 3; i++) {
    const v = vMin + ((vMax - vMin) * i) / 3;
    const yy = yAt(v);
    doc.line(cx, yy, cx + cw, yy);
    doc.text(`${v.toFixed(1)}°`, x + 1, yy + 1.2);
  }

  // Linhas de referência
  if (refMin !== null) {
    doc.setDrawColor(245, 158, 11);
    doc.setLineDashPattern([1, 1], 0);
    const yy = yAt(refMin);
    doc.line(cx, yy, cx + cw, yy);
    doc.setLineDashPattern([], 0);
  }
  if (refMax !== null) {
    doc.setDrawColor(239, 68, 68);
    doc.setLineDashPattern([1, 1], 0);
    const yy = yAt(refMax);
    doc.line(cx, yy, cx + cw, yy);
    doc.setLineDashPattern([], 0);
  }

  // Linha da série
  doc.setDrawColor(37, 99, 235);
  doc.setLineWidth(0.5);
  for (let i = 1; i < serie.length; i++) {
    doc.line(xAt(i - 1), yAt(serie[i - 1].valor), xAt(i), yAt(serie[i].valor));
  }
  doc.setLineWidth(0.2);

  // Labels de X (início, meio, fim)
  doc.setTextColor(120, 120, 120);
  doc.setFontSize(7);
  const idxs = [0, Math.floor((serie.length - 1) / 2), serie.length - 1];
  idxs.forEach((i, k) => {
    const label = serie[i].label;
    const tx = xAt(i);
    const align = k === 0 ? "left" : k === 2 ? "right" : "center";
    doc.text(label, tx, y + h - 2, { align: align as "left" | "right" | "center" });
  });
  doc.setTextColor(0, 0, 0);
}

function gerarPdf(
  periodoLabel: string,
  grupos: { lab: Laboratorio; itens: EstatBancada[] }[],
  seriesPorLab: Map<string, { label: string; valor: number }[]>,
  variedadeFiltro: string,
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const addPage = (h: number) => {
    if (y + h <= pageHeight - margin) return;
    doc.addPage();
    y = margin;
  };

  const tituloVariedade =
    variedadeFiltro && variedadeFiltro !== TODAS_VARIEDADES
      ? ` — Variedade: ${variedadeFiltro}`
      : "";

  doc.setProperties({ title: `Relatorio de Temperatura${tituloVariedade}` });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`Relatório de Temperatura${tituloVariedade}`, margin, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text(
    `Período: ${periodoLabel} · Gerado em ${new Date().toLocaleString("pt-BR")}`,
    margin,
    y,
  );
  y += 9;
  doc.setTextColor(0, 0, 0);

  grupos.forEach(({ lab, itens }) => {
    addPage(24);
    doc.setFillColor(0, 120, 90);
    doc.rect(margin, y, contentWidth, 2, "F");
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`${lab.nome} — ${itens.length} prateleira(s)`, margin, y);
    y += 6;

    // Gráfico da sala
    const serie = seriesPorLab.get(lab.id) ?? [];
    const mins = itens
      .map((i) => i.bancada.temp_min)
      .filter((v): v is number => typeof v === "number");
    const maxs = itens
      .map((i) => i.bancada.temp_max)
      .filter((v): v is number => typeof v === "number");
    const refMin = mins.length ? Math.min(...mins) : null;
    const refMax = maxs.length ? Math.max(...maxs) : null;
    const chartH = 45;
    addPage(chartH + 4);
    desenharGrafico(doc, margin, y, contentWidth, chartH, serie, refMin, refMax);
    y += chartH + 4;

    // Header linha
    const cols = ["Prateleira", "Variedade", "Mín °C", "Méd °C", "Máx °C", "Amostras", "Fora"];
    const colX = [
      margin + 2,
      margin + 42,
      margin + 82,
      margin + 100,
      margin + 118,
      margin + 138,
      margin + 162,
    ];
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, y, contentWidth, 6, "F");
    cols.forEach((c, i) => doc.text(c, colX[i], y + 4));
    y += 6;

    doc.setFont("helvetica", "normal");
    itens.forEach((it) => {
      addPage(6);
      const variedadesTxt =
        it.variedades.length > 0 ? it.variedades.join(", ") : "—";
      const row = [
        it.bancada.nome,
        variedadesTxt.length > 22 ? `${variedadesTxt.slice(0, 22)}…` : variedadesTxt,
        fmt(it.min),
        fmt(it.avg),
        fmt(it.max),
        String(it.n),
        it.foraFaixa > 0 ? String(it.foraFaixa) : "0",
      ];
      row.forEach((v, i) => doc.text(v, colX[i], y + 4));
      doc.setDrawColor(230, 230, 230);
      doc.line(margin, y + 5.5, margin + contentWidth, y + 5.5);
      y += 5.5;
    });
    y += 4;
  });

  const nomeArquivo =
    variedadeFiltro && variedadeFiltro !== TODAS_VARIEDADES
      ? `Relatorio de Temperatura - ${variedadeFiltro}.pdf`
      : "Relatorio de Temperatura.pdf";
  doc.save(nomeArquivo);
}


function RelatorioTemperaturaPage() {
  const [periodo, setPeriodo] = useState<PeriodoKey>("24h");
  const [labs, setLabs] = useState<Laboratorio[]>([]);
  const [bancadas, setBancadas] = useState<Bancada[]>([]);
  const [medicoes, setMedicoes] = useState<
    { bancada_id: string; valor: number; minuto: string }[]
  >([]);
  const [mudas, setMudas] = useState<MudaPeriodo[]>([]);
  const [variedade, setVariedade] = useState<string>(TODAS_VARIEDADES);
  const [loading, setLoading] = useState(true);
  const carregarRelatorio = useServerFn(listarRelatorioTemperatura);
  const carregarMudas = useServerFn(listarMudasPeriodo);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      const horas = PERIODOS[periodo].horas;
      const desde = new Date(Date.now() - horas * 3_600_000).toISOString();
      const ate = new Date().toISOString();
      const [dados, ms] = await Promise.all([
        carregarRelatorio({ data: { horas } }),
        carregarMudas({ data: { desde, ate } }),
      ]);
      if (!alive) return;
      const bancadasData = dados.bancadas as unknown as Bancada[];
      setLabs(dados.laboratorios as unknown as Laboratorio[]);
      setBancadas(bancadasData);
      setMedicoes(dados.medicoes);
      setMudas(ms);
      setLoading(false);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [periodo, carregarRelatorio, carregarMudas]);

  // Mudas indexadas por bancada, ordenadas por data_inicio DESC (mais recente
  // primeiro) — usadas para descobrir qual variedade estava ativa em cada ts.
  const mudasPorBancada = useMemo(() => {
    const map = new Map<string, MudaPeriodo[]>();
    for (const m of mudas) {
      if (!m.bancada_id) continue;
      const arr = map.get(m.bancada_id) ?? [];
      arr.push(m);
      map.set(m.bancada_id, arr);
    }
    for (const arr of map.values()) {
      arr.sort(
        (a, b) =>
          new Date(b.data_inicio).getTime() - new Date(a.data_inicio).getTime(),
      );
    }
    return map;
  }, [mudas]);

  const variedadesDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const m of mudas) set.add(m.identificador);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [mudas]);

  // Aplica o filtro de variedade sobre as medições: só passam pontos cuja
  // muda ativa naquele instante tenha o identificador selecionado.
  const medicoesFiltradas = useMemo(() => {
    if (variedade === TODAS_VARIEDADES) return medicoes;
    return medicoes.filter((m) => {
      const mudasB = mudasPorBancada.get(m.bancada_id);
      if (!mudasB) return false;
      const ativa = mudaAtivaEm(mudasB, new Date(m.minuto).getTime());
      return ativa?.identificador === variedade;
    });
  }, [medicoes, mudasPorBancada, variedade]);


  // Séries temporais agregadas por sala (média das prateleiras por bucket)
  const seriesPorLab = useMemo(() => {
    const horas = PERIODOS[periodo].horas;
    // bucket: 24h→10min, 7d→1h, 30d→6h, 90d→1d
    const bucketMin = horas <= 24 ? 10 : horas <= 24 * 7 ? 60 : horas <= 24 * 30 ? 360 : 1440;
    const bucketMs = bucketMin * 60 * 1000;
    const bancadaLab = new Map<string, string>();
    for (const b of bancadas) bancadaLab.set(b.id, b.laboratorio_id ?? "__sem_lab__");

    // labId -> bucketTs -> {max}
    const agg = new Map<string, Map<number, { max: number }>>();
    for (const m of medicoesFiltradas) {
      const labId = bancadaLab.get(m.bancada_id);
      if (!labId) continue;
      const ts = new Date(m.minuto).getTime();
      const bucket = Math.floor(ts / bucketMs) * bucketMs;
      let byLab = agg.get(labId);
      if (!byLab) {
        byLab = new Map();
        agg.set(labId, byLab);
      }
      const cur = byLab.get(bucket);
      if (!cur) byLab.set(bucket, { max: m.valor });
      else if (m.valor > cur.max) cur.max = m.valor;
    }

    const fmtLabel = (ts: number) => {
      const d = new Date(ts);
      if (bucketMin < 60) {
        return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      }
      if (bucketMin < 1440) {
        return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit" });
      }
      return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    };

    const out = new Map<string, { label: string; valor: number }[]>();
    for (const [labId, byLab] of agg) {
      const pts = Array.from(byLab.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([ts, v]) => ({ label: fmtLabel(ts), valor: Number(v.max.toFixed(2)) }));
      out.set(labId, pts);
    }
    return out;

  }, [medicoesFiltradas, bancadas, periodo]);


  const grupos = useMemo(() => {
    // Agrupa medições por bancada
    const porBancada = new Map<string, number[]>();
    const variedadesPorBancada = new Map<string, Set<string>>();
    for (const m of medicoesFiltradas) {
      const arr = porBancada.get(m.bancada_id) ?? [];
      arr.push(m.valor);
      porBancada.set(m.bancada_id, arr);

      const mudasB = mudasPorBancada.get(m.bancada_id);
      if (mudasB) {
        const ativa = mudaAtivaEm(mudasB, new Date(m.minuto).getTime());
        if (ativa) {
          const set = variedadesPorBancada.get(m.bancada_id) ?? new Set<string>();
          set.add(ativa.identificador);
          variedadesPorBancada.set(m.bancada_id, set);
        }
      }
    }

    const stats: Record<string, EstatBancada> = {};
    for (const b of bancadas) {
      const vals = porBancada.get(b.id) ?? [];
      let min: number | null = null;
      let max: number | null = null;
      let sum = 0;
      let fora = 0;
      for (const v of vals) {
        if (min === null || v < min) min = v;
        if (max === null || v > max) max = v;
        sum += v;
        if (
          (b.temp_min !== null && b.temp_min !== undefined && v < b.temp_min) ||
          (b.temp_max !== null && b.temp_max !== undefined && v > b.temp_max)
        ) {
          fora += 1;
        }
      }
      stats[b.id] = {
        bancada: b,
        n: vals.length,
        min,
        max,
        avg: vals.length > 0 ? sum / vals.length : null,
        foraFaixa: fora,
        variedades: Array.from(variedadesPorBancada.get(b.id) ?? []).sort(),
      };
    }

    const groups = labs
      .map((lab) => ({
        lab,
        itens: bancadas
          .filter((b) => b.laboratorio_id === lab.id)
          .map((b) => stats[b.id])
          // Se filtro de variedade estiver ativo, só mantém prateleiras que
          // realmente tiveram essa variedade no período.
          .filter((it) =>
            variedade === TODAS_VARIEDADES ? true : it.variedades.length > 0,
          ),
      }))
      .filter((g) => g.itens.length > 0);

    const semLab = bancadas
      .filter((b) => !b.laboratorio_id)
      .map((b) => stats[b.id])
      .filter((it) =>
        variedade === TODAS_VARIEDADES ? true : it.variedades.length > 0,
      );
    if (semLab.length > 0) {
      groups.push({
        lab: {
          id: "__sem_lab__",
          nome: "Sem sala bioreator",
          descricao: null,
          cor: "#94a3b8",
          ordem: 999,
          created_at: "",
        },
        itens: semLab,
      });
    }
    return groups;
  }, [labs, bancadas, medicoesFiltradas, mudasPorBancada, variedade]);

  const totalPontos = medicoesFiltradas.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-primary">
            <Thermometer className="h-6 w-6" /> Relatório de Temperatura
          </h1>
          <p className="text-sm text-muted-foreground">
            Estatísticas de temperatura das prateleiras por período.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/relatorios">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Ciclos
            </Link>
          </Button>
          <Select
            value={periodo}
            onValueChange={(v) => setPeriodo(v as PeriodoKey)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIODOS) as PeriodoKey[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {PERIODOS[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || grupos.length === 0}
            onClick={() => gerarPdf(PERIODOS[periodo].label, grupos, seriesPorLab)}
          >
            <FileText className="mr-1.5 h-4 w-4" /> Salvar PDF
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando medições…
        </div>
      ) : totalPontos === 0 ? (
        <Card className="card-elevated">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Thermometer className="h-8 w-8 text-muted-foreground" />
            <div className="font-semibold">Nenhuma medição no período</div>
            <p className="text-sm text-muted-foreground">
              O histórico começa a ser coletado a partir do momento em que a
              prateleira envia telemetria com temperatura válida.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grupos.map(({ lab, itens }) => (
            <Card key={lab.id} className="card-elevated overflow-hidden">
              <div className="h-1.5 w-full" style={{ background: lab.cor }} />
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FlaskConical className="h-4 w-4" style={{ color: lab.cor }} />
                  {lab.nome}
                  <Badge variant="outline" className="ml-1 text-[10px]">
                    {itens.length} prateleira{itens.length === 1 ? "" : "s"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {(() => {
                  const serie = seriesPorLab.get(lab.id) ?? [];
                  const mins = itens
                    .map((i) => i.bancada.temp_min)
                    .filter((v): v is number => typeof v === "number");
                  const maxs = itens
                    .map((i) => i.bancada.temp_max)
                    .filter((v): v is number => typeof v === "number");
                  const refMin = mins.length ? Math.min(...mins) : null;
                  const refMax = maxs.length ? Math.max(...maxs) : null;
                  if (serie.length < 2) {
                    return (
                      <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                        Dados insuficientes para o gráfico ({serie.length} ponto{serie.length === 1 ? "" : "s"}).
                      </div>
                    );
                  }
                  return (
                    <div className="h-56 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={serie} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 10 }}
                            interval="preserveStartEnd"
                            minTickGap={30}
                          />
                          <YAxis
                            tick={{ fontSize: 10 }}
                            domain={["auto", "auto"]}
                            width={36}
                            unit="°"
                          />
                          <Tooltip
                            contentStyle={{ fontSize: 12 }}
                            formatter={(v: number) => [`${v.toFixed(1)} °C`, "Temp"]}
                          />
                          {refMin !== null && (
                            <ReferenceLine
                              y={refMin}
                              stroke="#f59e0b"
                              strokeDasharray="4 4"
                              label={{ value: `min ${refMin}°`, fontSize: 10, fill: "#f59e0b", position: "insideBottomLeft" }}
                            />
                          )}
                          {refMax !== null && (
                            <ReferenceLine
                              y={refMax}
                              stroke="#ef4444"
                              strokeDasharray="4 4"
                              label={{ value: `max ${refMax}°`, fontSize: 10, fill: "#ef4444", position: "insideTopLeft" }}
                            />
                          )}
                          <Line
                            type="monotone"
                            dataKey="valor"
                            stroke="#2563eb"
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}
                <div className="overflow-x-auto">

                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                        <th className="py-2 pr-2">Prateleira</th>
                        <th className="py-2 pr-2 text-right">Mín °C</th>
                        <th className="py-2 pr-2 text-right">Média °C</th>
                        <th className="py-2 pr-2 text-right">Máx °C</th>
                        <th className="py-2 pr-2 text-right">Amostras</th>
                        <th className="py-2 pr-2 text-right">Fora da faixa</th>
                        <th className="py-2 pr-2 text-right">Faixa alvo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itens.map((it) => (
                        <tr key={it.bancada.id} className="border-b last:border-0">
                          <td className="py-2 pr-2 font-medium">
                            <Link
                              to="/bancadas/$id/grafico"
                              params={{ id: it.bancada.id }}
                              className="hover:underline"
                            >
                              {it.bancada.nome}
                            </Link>
                          </td>
                          <td className="py-2 pr-2 text-right font-mono">
                            {fmt(it.min)}
                          </td>
                          <td className="py-2 pr-2 text-right font-mono">
                            {fmt(it.avg)}
                          </td>
                          <td className="py-2 pr-2 text-right font-mono">
                            {fmt(it.max)}
                          </td>
                          <td className="py-2 pr-2 text-right font-mono text-muted-foreground">
                            {it.n}
                          </td>
                          <td className="py-2 pr-2 text-right font-mono">
                            {it.foraFaixa > 0 ? (
                              <Badge variant="destructive" className="text-[10px]">
                                {it.foraFaixa}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="py-2 pr-2 text-right font-mono text-xs text-muted-foreground">
                            {it.bancada.temp_min ?? "—"} … {it.bancada.temp_max ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
