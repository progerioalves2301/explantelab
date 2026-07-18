import { createFileRoute, Link } from "@tanstack/react-router";
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
import { supabase } from "@/integrations/supabase/client";
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
  "90d": { label: "Últimos 90 dias", horas: 24 * 90 },
} as const;

type PeriodoKey = keyof typeof PERIODOS;

type EstatBancada = {
  bancada: Bancada;
  n: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  foraFaixa: number;
};

function fmt(v: number | null, casas = 1) {
  if (v === null || !Number.isFinite(v)) return "—";
  return v.toFixed(casas);
}

function gerarPdf(
  periodoLabel: string,
  grupos: { lab: Laboratorio; itens: EstatBancada[] }[],
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

  doc.setProperties({ title: "Relatorio de Temperatura" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Relatório de Temperatura", margin, y);
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

    // Header linha
    const cols = ["Prateleira", "Mín °C", "Méd °C", "Máx °C", "Amostras", "Fora faixa"];
    const colX = [margin + 2, margin + 60, margin + 82, margin + 104, margin + 128, margin + 158];
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, y, contentWidth, 6, "F");
    cols.forEach((c, i) => doc.text(c, colX[i], y + 4));
    y += 6;

    doc.setFont("helvetica", "normal");
    itens.forEach((it) => {
      addPage(6);
      const row = [
        it.bancada.nome,
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

  doc.save("Relatorio de Temperatura.pdf");
}

function RelatorioTemperaturaPage() {
  const [periodo, setPeriodo] = useState<PeriodoKey>("24h");
  const [labs, setLabs] = useState<Laboratorio[]>([]);
  const [bancadas, setBancadas] = useState<Bancada[]>([]);
  const [medicoes, setMedicoes] = useState<
    { bancada_id: string; valor: number }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      const horas = PERIODOS[periodo].horas;
      const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString();

      const [labsRes, bancadasRes, medRes] = await Promise.all([
        supabase.from("laboratorios").select("*").order("ordem"),
        supabase.from("bancadas").select("*").order("posicao", { nullsFirst: false }),
        supabase
          .from("medicoes_temperatura")
          .select("bancada_id, valor")
          .gte("minuto", desde)
          .limit(100000),
      ]);
      if (!alive) return;
      setLabs((labsRes.data ?? []) as unknown as Laboratorio[]);
      setBancadas((bancadasRes.data ?? []) as unknown as Bancada[]);
      setMedicoes(
        ((medRes.data ?? []) as { bancada_id: string; valor: number | string }[]).map(
          (r) => ({ bancada_id: r.bancada_id, valor: Number(r.valor) }),
        ),
      );
      setLoading(false);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [periodo]);

  const grupos = useMemo(() => {
    // Agrupa medições por bancada
    const porBancada = new Map<string, number[]>();
    for (const m of medicoes) {
      const arr = porBancada.get(m.bancada_id) ?? [];
      arr.push(m.valor);
      porBancada.set(m.bancada_id, arr);
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
      };
    }

    const groups = labs
      .map((lab) => ({
        lab,
        itens: bancadas
          .filter((b) => b.laboratorio_id === lab.id)
          .map((b) => stats[b.id]),
      }))
      .filter((g) => g.itens.length > 0);

    const semLab = bancadas.filter((b) => !b.laboratorio_id);
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
        itens: semLab.map((b) => stats[b.id]),
      });
    }
    return groups;
  }, [labs, bancadas, medicoes]);

  const totalPontos = medicoes.length;

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
            onClick={() => gerarPdf(PERIODOS[periodo].label, grupos)}
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
              <CardContent>
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
