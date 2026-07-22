import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { jsPDF } from "jspdf";
import { useEffect, useMemo, useState } from "react";
import { Scale, FileText, Loader2 } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  listarRelatorioPeso,
  listarMudas,
  type PesagemRelatorio,
  type Muda,
} from "@/lib/mudas.functions";
import { listLaboratorios } from "@/lib/laboratorios.functions";
import type { Laboratorio } from "@/lib/types";

export const Route = createFileRoute("/_shell/relatorios-peso")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Relatório de Peso das Mudas" },
      { name: "description", content: "Evolução do peso das mudas ao longo do tempo." },
    ],
  }),
  component: RelatorioPesoPage,
});

const TODAS = "__todas__";
const PDF_FILENAME = "Relatorio de Peso das Mudas.pdf";

// Paleta consistente para linhas de variedades no gráfico
const CORES = [
  "#0ea5e9", "#22c55e", "#f97316", "#a855f7", "#ef4444",
  "#eab308", "#14b8a6", "#ec4899", "#6366f1", "#84cc16",
];

function toLocalDateInput(d: Date) {
  const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
  return iso.slice(0, 10);
}

function fmtDataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function fmtDataCurta(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function RelatorioPesoPage() {
  const listar = useServerFn(listarRelatorioPeso);
  const listLabs = useServerFn(listLaboratorios);

  const hoje = new Date();
  const trintaDias = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [desde, setDesde] = useState(toLocalDateInput(trintaDias));
  const [ate, setAte] = useState(toLocalDateInput(hoje));
  const [labId, setLabId] = useState<string>(TODAS);
  const [variedade, setVariedade] = useState<string>(TODAS);

  const [pesagens, setPesagens] = useState<PesagemRelatorio[]>([]);
  const [labs, setLabs] = useState<Laboratorio[]>([]);
  const [loading, setLoading] = useState(false);

  const carregar = async () => {
    setLoading(true);
    try {
      const desdeISO = new Date(`${desde}T00:00:00`).toISOString();
      const ateISO = new Date(`${ate}T23:59:59`).toISOString();
      const [p, l] = await Promise.all([
        listar({ data: { desde: desdeISO, ate: ateISO } }),
        listLabs(),
      ]);
      setPesagens(p);
      setLabs(l);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void carregar(); /* eslint-disable-next-line */ }, []);

  const variedadesDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const p of pesagens) if (p.muda_identificador) set.add(p.muda_identificador);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [pesagens]);

  const filtradas = useMemo(() => {
    return pesagens.filter((p) => {
      if (labId !== TODAS && p.laboratorio_id !== labId) return false;
      if (variedade !== TODAS && p.muda_identificador !== variedade) return false;
      return true;
    });
  }, [pesagens, labId, variedade]);

  // Agrupa por variedade (uma linha por variedade); dentro da variedade
  // agrega por dia com a média das pesagens.
  const chartData = useMemo(() => {
    // dia -> { data: string, [variedade]: number }
    const buckets = new Map<string, Record<string, number | string>>();
    // variedade -> dia -> [valores]
    const acc = new Map<string, Map<string, number[]>>();

    for (const p of filtradas) {
      const dia = new Date(p.medido_em).toISOString().slice(0, 10);
      const v = p.muda_identificador;
      if (!acc.has(v)) acc.set(v, new Map());
      const bydia = acc.get(v)!;
      if (!bydia.has(dia)) bydia.set(dia, []);
      bydia.get(dia)!.push(p.valor_g);
    }

    const variedades = Array.from(acc.keys()).sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    );

    for (const v of variedades) {
      const bydia = acc.get(v)!;
      for (const [dia, valores] of bydia) {
        const media = valores.reduce((s, x) => s + x, 0) / valores.length;
        const row = buckets.get(dia) ?? { data: dia };
        row[v] = Number(media.toFixed(2));
        buckets.set(dia, row);
      }
    }

    const rows = Array.from(buckets.values()).sort((a, b) =>
      String(a.data).localeCompare(String(b.data)),
    );
    return { rows, variedades };
  }, [filtradas]);

  const stats = useMemo(() => {
    if (filtradas.length === 0) {
      return { total: 0, mudas: 0, min: null as number | null, max: null as number | null, avg: null as number | null };
    }
    const valores = filtradas.map((p) => p.valor_g);
    const mudas = new Set(filtradas.map((p) => p.muda_id)).size;
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    const avg = valores.reduce((s, x) => s + x, 0) / valores.length;
    return { total: filtradas.length, mudas, min, max, avg };
  }, [filtradas]);

  // Estatísticas por variedade (crescimento entre primeira e última pesagem)
  const porVariedade = useMemo(() => {
    const map = new Map<string, PesagemRelatorio[]>();
    for (const p of filtradas) {
      const arr = map.get(p.muda_identificador) ?? [];
      arr.push(p);
      map.set(p.muda_identificador, arr);
    }
    return Array.from(map.entries())
      .map(([v, arr]) => {
        arr.sort(
          (a, b) => new Date(a.medido_em).getTime() - new Date(b.medido_em).getTime(),
        );
        const inicial = arr[0]!;
        const final = arr[arr.length - 1]!;
        const delta = final.valor_g - inicial.valor_g;
        const deltaPct = inicial.valor_g > 0 ? (delta / inicial.valor_g) * 100 : null;
        return {
          variedade: v,
          n: arr.length,
          peso_inicial: inicial.valor_g,
          peso_final: final.valor_g,
          delta,
          deltaPct,
          dataInicial: inicial.medido_em,
          dataFinal: final.medido_em,
          especie: inicial.muda_especie,
        };
      })
      .sort((a, b) => a.variedade.localeCompare(b.variedade, "pt-BR"));
  }, [filtradas]);

  const gerarPdf = () => {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 12;
    let y = margin;

    const tituloVar =
      variedade !== TODAS ? ` — Variedade: ${variedade}` : "";
    doc.setProperties({ title: `Relatorio de Peso das Mudas${tituloVar}` });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(`Relatório de Peso das Mudas${tituloVar}`, margin, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    doc.text(
      `Período: ${new Date(desde).toLocaleDateString("pt-BR")} a ${new Date(ate).toLocaleDateString("pt-BR")}`,
      margin,
      y,
    );
    y += 5;
    doc.text(
      `Total de pesagens: ${stats.total}  ·  Mudas: ${stats.mudas}  ·  Mín: ${stats.min?.toFixed(1) ?? "—"} g  ·  Máx: ${stats.max?.toFixed(1) ?? "—"} g  ·  Média: ${stats.avg?.toFixed(1) ?? "—"} g`,
      margin,
      y,
    );
    y += 8;
    doc.setTextColor(0, 0, 0);

    // Desenha gráfico simples: eixo com min/max e linha por variedade
    const chartW = pageW - margin * 2;
    const chartH = 60;
    const chartX = margin;
    const chartY = y;
    doc.setDrawColor(200, 200, 200);
    doc.rect(chartX, chartY, chartW, chartH);

    const rows = chartData.rows;
    if (rows.length > 0 && chartData.variedades.length > 0) {
      const todosValores: number[] = [];
      for (const r of rows) {
        for (const v of chartData.variedades) {
          const val = r[v];
          if (typeof val === "number") todosValores.push(val);
        }
      }
      const vmin = Math.min(...todosValores);
      const vmax = Math.max(...todosValores);
      const range = vmax - vmin || 1;
      const dxN = rows.length > 1 ? rows.length - 1 : 1;

      // Eixo Y
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(`${vmax.toFixed(1)} g`, chartX + 1, chartY + 4);
      doc.text(`${vmin.toFixed(1)} g`, chartX + 1, chartY + chartH - 1);

      chartData.variedades.forEach((v, i) => {
        const cor = CORES[i % CORES.length]!;
        const rgb = hexToRgb(cor);
        doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
        doc.setLineWidth(0.5);
        let px: number | null = null;
        let py: number | null = null;
        rows.forEach((r, idx) => {
          const val = r[v];
          if (typeof val !== "number") return;
          const x = chartX + (idx / dxN) * chartW;
          const yy = chartY + chartH - ((val - vmin) / range) * chartH;
          if (px !== null && py !== null) doc.line(px, py, x, yy);
          px = x;
          py = yy;
        });
      });

      // Legenda
      let lx = chartX + 2;
      let ly = chartY + chartH + 4;
      doc.setFontSize(7.5);
      chartData.variedades.forEach((v, i) => {
        const cor = CORES[i % CORES.length]!;
        const rgb = hexToRgb(cor);
        doc.setFillColor(rgb[0], rgb[1], rgb[2]);
        doc.rect(lx, ly - 2, 3, 3, "F");
        doc.setTextColor(60, 60, 60);
        const label = v;
        doc.text(label, lx + 4, ly);
        lx += doc.getTextWidth(label) + 12;
        if (lx > pageW - margin - 30) { lx = chartX + 2; ly += 5; }
      });
      y = ly + 4;
    } else {
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text("Sem dados no período.", chartX + 3, chartY + chartH / 2);
      y = chartY + chartH + 6;
    }
    doc.setTextColor(0, 0, 0);

    // Tabela: resumo por variedade
    if (porVariedade.length > 0) {
      if (y + 20 > pageH - margin) { doc.addPage(); y = margin; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Resumo por variedade", margin, y);
      y += 5;

      const cols = [
        { label: "Variedade", w: 30 },
        { label: "Espécie", w: 32 },
        { label: "N", w: 10 },
        { label: "Inicial (g)", w: 22 },
        { label: "Final (g)", w: 22 },
        { label: "Δ (g)", w: 18 },
        { label: "Δ %", w: 16 },
        { label: "Período", w: 36 },
      ];
      const drawHeader = () => {
        doc.setFillColor(240, 240, 240);
        doc.rect(margin, y, pageW - margin * 2, 6, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        let x = margin + 1;
        cols.forEach((c) => { doc.text(c.label, x, y + 4); x += c.w; });
        y += 6;
        doc.setFont("helvetica", "normal");
      };
      drawHeader();

      porVariedade.forEach((p) => {
        if (y + 6 > pageH - margin) { doc.addPage(); y = margin; drawHeader(); }
        doc.setFontSize(8);
        let x = margin + 1;
        doc.text(p.variedade.slice(0, 20), x, y + 4); x += cols[0]!.w;
        doc.text((p.especie ?? "—").slice(0, 22), x, y + 4); x += cols[1]!.w;
        doc.text(String(p.n), x, y + 4); x += cols[2]!.w;
        doc.text(p.peso_inicial.toFixed(1), x, y + 4); x += cols[3]!.w;
        doc.text(p.peso_final.toFixed(1), x, y + 4); x += cols[4]!.w;
        if (p.delta > 0) doc.setTextColor(20, 130, 40);
        else if (p.delta < 0) doc.setTextColor(200, 30, 30);
        doc.text(`${p.delta >= 0 ? "+" : ""}${p.delta.toFixed(1)}`, x, y + 4);
        doc.setTextColor(0, 0, 0);
        x += cols[5]!.w;
        doc.text(p.deltaPct != null ? `${p.deltaPct >= 0 ? "+" : ""}${p.deltaPct.toFixed(1)}%` : "—", x, y + 4);
        x += cols[6]!.w;
        doc.text(`${fmtDataCurta(p.dataInicial)}→${fmtDataCurta(p.dataFinal)}`, x, y + 4);
        doc.setDrawColor(230, 230, 230);
        doc.line(margin, y + 6, pageW - margin, y + 6);
        y += 6;
      });
      y += 4;
    }

    // Tabela: pesagens detalhadas
    if (filtradas.length > 0) {
      if (y + 20 > pageH - margin) { doc.addPage(); y = margin; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Pesagens", margin, y);
      y += 5;

      const cols = [
        { label: "Data/Hora", w: 34 },
        { label: "Variedade", w: 28 },
        { label: "Prateleira", w: 28 },
        { label: "Sala", w: 42 },
        { label: "Peso (g)", w: 22 },
        { label: "Origem", w: 32 },
      ];
      const drawHeader = () => {
        doc.setFillColor(240, 240, 240);
        doc.rect(margin, y, pageW - margin * 2, 6, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        let x = margin + 1;
        cols.forEach((c) => { doc.text(c.label, x, y + 4); x += c.w; });
        y += 6;
        doc.setFont("helvetica", "normal");
      };
      drawHeader();

      filtradas.forEach((p) => {
        if (y + 6 > pageH - margin) { doc.addPage(); y = margin; drawHeader(); }
        doc.setFontSize(8);
        let x = margin + 1;
        doc.text(fmtDataHora(p.medido_em), x, y + 4); x += cols[0]!.w;
        doc.text(p.muda_identificador.slice(0, 18), x, y + 4); x += cols[1]!.w;
        doc.text((p.bancada_nome ?? "—").slice(0, 18), x, y + 4); x += cols[2]!.w;
        doc.text((p.laboratorio_nome ?? "—").slice(0, 28), x, y + 4); x += cols[3]!.w;
        doc.text(p.valor_g.toFixed(1), x, y + 4); x += cols[4]!.w;
        doc.text(p.origem, x, y + 4);
        doc.setDrawColor(230, 230, 230);
        doc.line(margin, y + 6, pageW - margin, y + 6);
        y += 6;
      });
    }

    const nome =
      variedade !== TODAS
        ? `Relatorio de Peso das Mudas - ${variedade}.pdf`
        : PDF_FILENAME;
    doc.save(nome);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-primary">
            <Scale className="h-6 w-6" /> Relatório de Peso das Mudas
          </h1>
          <p className="text-sm text-muted-foreground">
            Evolução do peso das mudas ao longo do tempo, por variedade.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/relatorios">Relatório de Ciclos</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={gerarPdf} disabled={filtradas.length === 0}>
            <FileText className="mr-1.5 h-4 w-4" /> Salvar PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-4 md:grid-cols-5">
          <div>
            <Label className="text-xs">De</Label>
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Até</Label>
            <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Sala</Label>
            <Select value={labId} onValueChange={setLabId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todas</SelectItem>
                {labs.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Variedade</Label>
            <Select value={variedade} onValueChange={setVariedade}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todas</SelectItem>
                {variedadesDisponiveis.map((v) => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button size="sm" onClick={carregar} disabled={loading} className="w-full">
              {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Atualizar
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-2 md:grid-cols-4">
        <StatCard label="Pesagens" value={String(stats.total)} />
        <StatCard label="Mudas" value={String(stats.mudas)} />
        <StatCard label="Mín / Máx" value={stats.min != null && stats.max != null ? `${stats.min.toFixed(1)} / ${stats.max.toFixed(1)} g` : "—"} />
        <StatCard label="Média" value={stats.avg != null ? `${stats.avg.toFixed(1)} g` : "—"} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Evolução do peso (média diária por variedade)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : chartData.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma pesagem no período/filtros selecionados.
            </p>
          ) : (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData.rows} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="data"
                    tickFormatter={(d) => fmtDataCurta(String(d))}
                    fontSize={11}
                  />
                  <YAxis fontSize={11} unit=" g" />
                  <Tooltip
                    labelFormatter={(d) => new Date(String(d)).toLocaleDateString("pt-BR")}
                    formatter={(v: number) => [`${Number(v).toFixed(1)} g`, ""]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {chartData.variedades.map((v, i) => (
                    <Line
                      key={v}
                      type="monotone"
                      dataKey={v}
                      stroke={CORES[i % CORES.length]}
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {porVariedade.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Resumo por variedade</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Variedade</TableHead>
                    <TableHead>Espécie</TableHead>
                    <TableHead className="text-right">N</TableHead>
                    <TableHead className="text-right">Inicial</TableHead>
                    <TableHead className="text-right">Final</TableHead>
                    <TableHead className="text-right">Δ (g)</TableHead>
                    <TableHead className="text-right">Δ %</TableHead>
                    <TableHead>Período</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porVariedade.map((p) => (
                    <TableRow key={p.variedade}>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px]">{p.variedade}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{p.especie ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{p.n}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{p.peso_inicial.toFixed(1)} g</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{p.peso_final.toFixed(1)} g</TableCell>
                      <TableCell className={`text-right text-xs tabular-nums ${p.delta > 0 ? "text-green-600" : p.delta < 0 ? "text-red-600" : ""}`}>
                        {p.delta >= 0 ? "+" : ""}{p.delta.toFixed(1)}
                      </TableCell>
                      <TableCell className={`text-right text-xs tabular-nums ${p.deltaPct != null && p.deltaPct > 0 ? "text-green-600" : p.deltaPct != null && p.deltaPct < 0 ? "text-red-600" : ""}`}>
                        {p.deltaPct != null ? `${p.deltaPct >= 0 ? "+" : ""}${p.deltaPct.toFixed(1)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDataCurta(p.dataInicial)} → {fmtDataCurta(p.dataFinal)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pesagens</CardTitle>
        </CardHeader>
        <CardContent>
          {filtradas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma pesagem no período/filtros selecionados.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data/Hora</TableHead>
                    <TableHead>Variedade</TableHead>
                    <TableHead>Prateleira</TableHead>
                    <TableHead>Sala</TableHead>
                    <TableHead className="text-right">Peso</TableHead>
                    <TableHead>Origem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtradas.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums">{fmtDataHora(p.medido_em)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px]">{p.muda_identificador}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{p.bancada_nome ?? "—"}</TableCell>
                      <TableCell className="text-xs">{p.laboratorio_nome ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums font-medium">{p.valor_g.toFixed(1)} g</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.origem}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-bold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b];
}
