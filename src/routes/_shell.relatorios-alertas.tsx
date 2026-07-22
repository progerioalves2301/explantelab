import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { jsPDF } from "jspdf";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileText, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { listarAlertasPeriodo, type Alerta } from "@/lib/alertas.functions";
import { listLaboratorios } from "@/lib/laboratorios.functions";
import { listarMudasPeriodo, type MudaPeriodo } from "@/lib/mudas.functions";
import type { Laboratorio } from "@/lib/types";

export const Route = createFileRoute("/_shell/relatorios-alertas")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Relatório de Alertas" },
      { name: "description", content: "Histórico de alertas gerados pelas prateleiras." },
    ],
  }),
  component: RelatoriosAlertasPage,
});

const PDF_FILENAME = "Relatorio de Alertas.pdf";
const TODAS_VARIEDADES = "__todas__";

function toLocalDateInput(d: Date) {
  const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
  return iso.slice(0, 10);
}

function fmtDataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function mudaAtivaEm(mudasDaBancada: MudaPeriodo[], ts: number): MudaPeriodo | null {
  for (const m of mudasDaBancada) {
    const ini = new Date(m.data_inicio).getTime();
    const fim = m.data_fim ? new Date(m.data_fim).getTime() : Infinity;
    if (ts >= ini && ts <= fim) return m;
  }
  return null;
}

const TIPO_LABEL: Record<string, string> = {
  offline: "Offline",
  temperatura: "Temperatura",
  ciclo: "Ciclo",
};

function RelatoriosAlertasPage() {
  const listar = useServerFn(listarAlertasPeriodo);
  const listLabs = useServerFn(listLaboratorios);
  const listMudas = useServerFn(listarMudasPeriodo);

  const hoje = new Date();
  const seteDias = new Date(hoje.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [desde, setDesde] = useState(toLocalDateInput(seteDias));
  const [ate, setAte] = useState(toLocalDateInput(hoje));
  const [tipo, setTipo] = useState<string>("todos");
  const [severidade, setSeveridade] = useState<string>("todas");
  const [labId, setLabId] = useState<string>("todas");
  const [status, setStatus] = useState<string>("todos");
  const [variedade, setVariedade] = useState<string>(TODAS_VARIEDADES);

  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [labs, setLabs] = useState<Laboratorio[]>([]);
  const [mudas, setMudas] = useState<MudaPeriodo[]>([]);
  const [loading, setLoading] = useState(false);

  const carregar = async () => {
    setLoading(true);
    try {
      const desdeISO = new Date(`${desde}T00:00:00`).toISOString();
      const ateISO = new Date(`${ate}T23:59:59`).toISOString();
      const [a, l, m] = await Promise.all([
        listar({ data: { desde: desdeISO, ate: ateISO } }),
        listLabs(),
        listMudas({ data: { desde: desdeISO, ate: ateISO } }),
      ]);
      setAlertas(a);
      setLabs(l);
      setMudas(m);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void carregar(); /* eslint-disable-next-line */ }, []);

  const labById = useMemo(() => new Map(labs.map((l) => [l.id, l])), [labs]);

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

  const variedadeDoAlerta = (a: Alerta): string | null => {
    const mudasB = mudasPorBancada.get(a.bancada_id);
    if (!mudasB) return null;
    const ativa = mudaAtivaEm(mudasB, new Date(a.created_at).getTime());
    return ativa?.identificador ?? null;
  };

  const filtrados = useMemo(() => {
    return alertas.filter((a) => {
      if (tipo !== "todos" && a.tipo !== tipo) return false;
      if (severidade !== "todas" && a.severidade !== severidade) return false;
      if (status === "abertos" && a.resolvido_em) return false;
      if (status === "resolvidos" && !a.resolvido_em) return false;
      if (labId !== "todas") {
        const lid = (a as any).laboratorio_id as string | null;
        if (lid !== labId) return false;
      }
      if (variedade !== TODAS_VARIEDADES) {
        if (variedadeDoAlerta(a) !== variedade) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertas, tipo, severidade, status, labId, variedade, mudasPorBancada]);

  const stats = useMemo(() => {
    const porTipo: Record<string, number> = {};
    const porSev: Record<string, number> = { warning: 0, critical: 0 };
    let abertos = 0;
    for (const a of filtrados) {
      porTipo[a.tipo] = (porTipo[a.tipo] ?? 0) + 1;
      porSev[a.severidade] = (porSev[a.severidade] ?? 0) + 1;
      if (!a.resolvido_em) abertos += 1;
    }
    return { porTipo, porSev, abertos, total: filtrados.length };
  }, [filtrados]);

  const gerarPdf = () => {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 12;
    let y = margin;

    const tituloVar =
      variedade && variedade !== TODAS_VARIEDADES ? ` — Variedade: ${variedade}` : "";
    doc.setProperties({ title: `Relatorio de Alertas${tituloVar}` });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(`Relatório de Alertas${tituloVar}`, margin, y);
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
      `Total: ${stats.total}  ·  Abertos: ${stats.abertos}  ·  Críticos: ${stats.porSev.critical ?? 0}  ·  Avisos: ${stats.porSev.warning ?? 0}`,
      margin,
      y,
    );
    y += 8;
    doc.setTextColor(0, 0, 0);

    // Cabeçalho da tabela
    const cols = [
      { label: "Data/Hora", w: 30 },
      { label: "Prateleira", w: 26 },
      { label: "Variedade", w: 26 },
      { label: "Tipo", w: 20 },
      { label: "Sev.", w: 14 },
      { label: "Mensagem", w: 45 },
      { label: "Status", w: 20 },
    ];
    const drawHeader = () => {
      doc.setFillColor(240, 240, 240);
      doc.rect(margin, y, pageW - margin * 2, 6, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      let x = margin + 1;
      cols.forEach((c) => {
        doc.text(c.label, x, y + 4);
        x += c.w;
      });
      y += 6;
      doc.setFont("helvetica", "normal");
    };
    drawHeader();

    filtrados.forEach((a) => {
      const msgLines = doc.splitTextToSize(a.mensagem, cols[5].w - 1) as string[];
      const rowH = Math.max(6, msgLines.length * 3.6 + 2);
      if (y + rowH > pageH - margin) {
        doc.addPage();
        y = margin;
        drawHeader();
      }
      const vr = variedadeDoAlerta(a) ?? "—";
      doc.setFontSize(8);
      let x = margin + 1;
      doc.text(fmtDataHora(a.created_at), x, y + 4);
      x += cols[0].w;
      doc.text((a.bancada_nome ?? "-").slice(0, 18), x, y + 4);
      x += cols[1].w;
      doc.text(vr.length > 18 ? `${vr.slice(0, 18)}…` : vr, x, y + 4);
      x += cols[2].w;
      doc.text(TIPO_LABEL[a.tipo] ?? a.tipo, x, y + 4);
      x += cols[3].w;
      if (a.severidade === "critical") doc.setTextColor(200, 30, 30);
      else doc.setTextColor(180, 130, 0);
      doc.text(a.severidade === "critical" ? "Crítico" : "Aviso", x, y + 4);
      doc.setTextColor(0, 0, 0);
      x += cols[4].w;
      msgLines.forEach((line, i) => doc.text(line, x, y + 4 + i * 3.6));
      x += cols[5].w;
      doc.text(a.resolvido_em ? "Resolvido" : "Aberto", x, y + 4);
      doc.setDrawColor(230, 230, 230);
      doc.line(margin, y + rowH, pageW - margin, y + rowH);
      y += rowH;
    });

    const nome =
      variedade && variedade !== TODAS_VARIEDADES
        ? `Relatorio de Alertas - ${variedade}.pdf`
        : PDF_FILENAME;
    doc.save(nome);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-primary">
            <AlertTriangle className="h-6 w-6" /> Relatório de Alertas
          </h1>
          <p className="text-sm text-muted-foreground">
            Histórico de alertas gerados pelas prateleiras (offline, temperatura, ciclo).
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/relatorios">Relatório de Ciclos</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={gerarPdf} disabled={filtrados.length === 0}>
            <FileText className="mr-1.5 h-4 w-4" /> Salvar PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-4 md:grid-cols-6">
          <div>
            <Label className="text-xs">De</Label>
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Até</Label>
            <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="offline">Offline</SelectItem>
                <SelectItem value="temperatura">Temperatura</SelectItem>
                <SelectItem value="ciclo">Ciclo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Severidade</Label>
            <Select value={severidade} onValueChange={setSeveridade}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="critical">Crítico</SelectItem>
                <SelectItem value="warning">Aviso</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="abertos">Abertos</SelectItem>
                <SelectItem value="resolvidos">Resolvidos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Sala</Label>
            <Select value={labId} onValueChange={setLabId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
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
                <SelectItem value={TODAS_VARIEDADES}>Todas</SelectItem>
                {variedadesDisponiveis.map((v) => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-6">
            <Button size="sm" onClick={carregar} disabled={loading}>
              {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Atualizar
            </Button>
          </div>

        </CardContent>
      </Card>

      <div className="grid gap-2 md:grid-cols-4">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Abertos" value={stats.abertos} />
        <StatCard label="Críticos" value={stats.porSev.critical ?? 0} />
        <StatCard label="Avisos" value={stats.porSev.warning ?? 0} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ocorrências</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : filtrados.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum alerta no período/filtros selecionados.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data/Hora</TableHead>
                    <TableHead>Prateleira</TableHead>
                    <TableHead>Variedade</TableHead>
                    <TableHead>Sala</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Severidade</TableHead>
                    <TableHead>Mensagem</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Resolvido em</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtrados.map((a) => {
                    const lid = (a as any).laboratorio_id as string | null;
                    const lab = lid ? labById.get(lid) : null;
                    const vr = variedadeDoAlerta(a);
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="whitespace-nowrap text-xs tabular-nums">
                          {fmtDataHora(a.created_at)}
                        </TableCell>
                        <TableCell className="text-xs">{a.bancada_nome ?? "-"}</TableCell>
                        <TableCell className="text-xs">
                          {vr ? (
                            <Badge variant="secondary" className="text-[10px]">{vr}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{lab?.nome ?? "-"}</TableCell>

                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {TIPO_LABEL[a.tipo] ?? a.tipo}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={a.severidade === "critical" ? "destructive" : "secondary"}
                            className="text-[10px]"
                          >
                            {a.severidade === "critical" ? "Crítico" : "Aviso"}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[360px] text-xs">{a.mensagem}</TableCell>
                        <TableCell>
                          <Badge variant={a.resolvido_em ? "outline" : "default"} className="text-[10px]">
                            {a.resolvido_em ? "Resolvido" : "Aberto"}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                          {a.resolvido_em ? fmtDataHora(a.resolvido_em) : "-"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
