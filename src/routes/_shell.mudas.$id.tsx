import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, LineChart as LineChartIcon, RefreshCw, Trash2, FileDown } from "lucide-react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { format } from "date-fns";
import jsPDF from "jspdf";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  listarMudas, listarPesagens, excluirPesagem,
  type Muda, type MedicaoPeso,
} from "@/lib/mudas.functions";

export const Route = createFileRoute("/_shell/mudas/$id")({
  head: () => ({
    meta: [
      { title: "Curva de crescimento — VitroCeres OS" },
      { name: "description", content: "Curva de crescimento (peso × tempo) da muda." },
    ],
  }),
  component: CurvaPage,
});

function CurvaPage() {
  const { id } = useParams({ from: "/_shell/mudas/$id" });
  const listMudas = useServerFn(listarMudas);
  const listPes = useServerFn(listarPesagens);
  const rmPes = useServerFn(excluirPesagem);

  const [muda, setMuda] = useState<Muda | null>(null);
  const [pontos, setPontos] = useState<MedicaoPeso[]>([]);
  const [loading, setLoading] = useState(true);

  const carregar = async () => {
    setLoading(true);
    try {
      const [ms, ps] = await Promise.all([
        listMudas({ data: {} }),
        listPes({ data: { muda_id: id } }),
      ]);
      setMuda(ms.find((m) => m.id === id) ?? null);
      setPontos(ps);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void carregar(); /* eslint-disable-next-line */ }, [id]);

  const valores = pontos.map((p) => Number(p.valor_g));
  const min = valores.length ? Math.min(...valores) : null;
  const max = valores.length ? Math.max(...valores) : null;
  const inicial = valores[0] ?? null;
  const ultimo = valores[valores.length - 1] ?? null;
  const ganho = inicial != null && ultimo != null ? ultimo - inicial : null;
  const ganhoPct = inicial && ultimo != null ? ((ultimo - inicial) / inicial) * 100 : null;

  const dados = pontos.map((p) => ({
    ts: new Date(p.medido_em).getTime(),
    label: format(new Date(p.medido_em), "dd/MM HH:mm"),
    valor: Number(p.valor_g),
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/mudas" className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar
            </Link>
          </div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold">
            <LineChartIcon className="h-6 w-6 text-primary" />
            {muda ? muda.identificador : "…"}
          </h1>
          {muda?.especie && <p className="text-sm text-muted-foreground">{muda.especie}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <Button size="sm" onClick={() => gerarPdf(muda, pontos)} disabled={!muda || pontos.length === 0}>
            <FileDown className="mr-1.5 h-4 w-4" /> Baixar PDF
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Pesagens" value={pontos.length.toString()} />
        <StatCard label="Inicial" value={inicial != null ? `${inicial.toFixed(2)} g` : "—"} />
        <StatCard label="Atual" value={ultimo != null ? `${ultimo.toFixed(2)} g` : "—"} />
        <StatCard
          label="Ganho"
          value={
            ganho != null
              ? `${ganho > 0 ? "+" : ""}${ganho.toFixed(2)} g${ganhoPct != null ? ` (${ganhoPct.toFixed(1)}%)` : ""}`
              : "—"
          }
        />
        <StatCard label="Mín / Máx" value={min != null && max != null ? `${min.toFixed(1)} / ${max.toFixed(1)} g` : "—"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Curva de crescimento (g × tempo)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid h-[360px] place-items-center text-sm text-muted-foreground">Carregando…</div>
          ) : pontos.length === 0 ? (
            <div className="grid h-[360px] place-items-center text-center text-sm text-muted-foreground">
              Nenhuma pesagem registrada ainda.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={dados} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" minTickGap={40} tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  domain={["dataMin - 1", "dataMax + 1"]}
                  tickFormatter={(v) => `${v}g`}
                  width={55}
                />
                <Tooltip
                  formatter={(v: number) => [`${v.toFixed(2)} g`, "Peso"]}
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="valor"
                  name="Peso"
                  stroke="var(--leaf)"
                  strokeWidth={3}
                  dot={{ r: 3, fill: "var(--leaf)" }}
                  activeDot={{ r: 6 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico</CardTitle>
        </CardHeader>
        <CardContent>
          {pontos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem registros.</p>
          ) : (
            <div className="divide-y">
              {[...pontos].reverse().map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 text-sm gap-2">
                  <div className="min-w-0">
                    <div className="tabular-nums font-medium">
                      {Number(p.valor_g).toFixed(2)} g
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(p.medido_em), "dd/MM/yyyy HH:mm")}
                      {p.observacoes ? ` · ${p.observacoes}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase">{p.origem}</Badge>
                    <Button
                      variant="ghost" size="sm"
                      className="text-destructive"
                      onClick={async () => {
                        if (!confirm("Excluir esta pesagem?")) return;
                        await rmPes({ data: { id: p.id } });
                        toast.success("Pesagem excluída");
                        void carregar();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
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

function gerarPdf(muda: Muda | null, pontos: MedicaoPeso[]) {
  if (!muda || pontos.length === 0) return;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(`Curva de crescimento — ${muda.identificador}`, 15, 18);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const meta: string[] = [];
  if (muda.especie) meta.push(`Espécie: ${muda.especie}`);
  meta.push(`Início: ${format(new Date(muda.data_inicio), "dd/MM/yyyy")}`);
  meta.push(`Pesagens: ${pontos.length}`);
  meta.push(`Gerado em: ${format(new Date(), "dd/MM/yyyy HH:mm")}`);
  doc.text(meta.join("   ·   "), 15, 25);

  const valores = pontos.map((p) => Number(p.valor_g));
  const inicial = valores[0];
  const ultimo = valores[valores.length - 1];
  const ganho = ultimo - inicial;
  const ganhoPct = inicial ? (ganho / inicial) * 100 : 0;
  const min = Math.min(...valores);
  const max = Math.max(...valores);

  doc.setFontSize(10);
  const stats = [
    `Inicial: ${inicial.toFixed(2)} g`,
    `Atual: ${ultimo.toFixed(2)} g`,
    `Ganho: ${ganho > 0 ? "+" : ""}${ganho.toFixed(2)} g (${ganhoPct.toFixed(1)}%)`,
    `Mín / Máx: ${min.toFixed(2)} / ${max.toFixed(2)} g`,
  ];
  doc.text(stats.join("   ·   "), 15, 32);

  // Gráfico
  const gx = 20, gy = 45, gw = W - 40, gh = 90;
  doc.setDrawColor(180);
  doc.setLineWidth(0.2);
  doc.rect(gx, gy, gw, gh);

  const yMin = Math.floor(min - 1);
  const yMax = Math.ceil(max + 1);
  const yRange = Math.max(yMax - yMin, 0.5);
  const ts = pontos.map((p) => new Date(p.medido_em).getTime());
  const tMin = ts[0];
  const tMax = ts[ts.length - 1];
  const tRange = Math.max(tMax - tMin, 1);

  // Grid + eixos Y
  doc.setDrawColor(230);
  doc.setFontSize(8);
  for (let i = 0; i <= 5; i++) {
    const y = gy + (gh / 5) * i;
    doc.line(gx, y, gx + gw, y);
    const val = yMax - (yRange / 5) * i;
    doc.text(`${val.toFixed(1)}g`, gx - 2, y + 1.5, { align: "right" });
  }

  // Eixo X (datas)
  const nTicksX = Math.min(6, pontos.length);
  for (let i = 0; i < nTicksX; i++) {
    const idx = Math.round(((pontos.length - 1) * i) / (nTicksX - 1 || 1));
    const x = gx + (gw * (ts[idx] - tMin)) / tRange;
    doc.text(format(new Date(ts[idx]), "dd/MM HH:mm"), x, gy + gh + 5, { align: "center" });
  }

  // Linha
  doc.setDrawColor(34, 139, 34);
  doc.setLineWidth(0.6);
  for (let i = 1; i < pontos.length; i++) {
    const x1 = gx + (gw * (ts[i - 1] - tMin)) / tRange;
    const y1 = gy + gh - (gh * (valores[i - 1] - yMin)) / yRange;
    const x2 = gx + (gw * (ts[i] - tMin)) / tRange;
    const y2 = gy + gh - (gh * (valores[i] - yMin)) / yRange;
    doc.line(x1, y1, x2, y2);
  }
  // Pontos
  doc.setFillColor(34, 139, 34);
  for (let i = 0; i < pontos.length; i++) {
    const x = gx + (gw * (ts[i] - tMin)) / tRange;
    const y = gy + gh - (gh * (valores[i] - yMin)) / yRange;
    doc.circle(x, y, 0.7, "F");
  }

  // Tabela de histórico
  let yy = gy + gh + 15;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Histórico de pesagens", 15, yy);
  yy += 5;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Data/Hora", 15, yy);
  doc.text("Peso (g)", 80, yy);
  doc.text("Origem", 115, yy);
  doc.text("Observações", 145, yy);
  yy += 2;
  doc.setDrawColor(200);
  doc.line(15, yy, W - 15, yy);
  yy += 4;

  for (const p of pontos) {
    if (yy > 280) { doc.addPage(); yy = 20; }
    doc.text(format(new Date(p.medido_em), "dd/MM/yyyy HH:mm"), 15, yy);
    doc.text(Number(p.valor_g).toFixed(2), 80, yy);
    doc.text(p.origem, 115, yy);
    if (p.observacoes) doc.text(p.observacoes.slice(0, 40), 145, yy);
    yy += 5;
  }

  doc.save(`Curva_${muda.identificador}.pdf`);
}

