import { createFileRoute } from "@tanstack/react-router";
import { jsPDF } from "jspdf";
import { useEffect, useMemo, useState } from "react";
import { FileText, FlaskConical, Clock, Loader2 } from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { Bancada, Laboratorio } from "@/lib/types";

export const Route = createFileRoute("/_shell/relatorios")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Relatorio de Ciclos" },
      {
        name: "description",
        content:
          "Relatório de programação de ciclos das bancadas, agrupado por sala bioreator.",
      },
    ],
  }),
  component: RelatoriosPage,
});

const SEM_LAB = "__sem_lab__";
const PDF_FILENAME = "Relatorio de Ciclos.pdf";

type SalaComBancadas = {
  lab: Laboratorio;
  bancadas: Bancada[];
};

function fmtSegundos(total: number) {
  if (!Number.isFinite(total) || total <= 0) return "0s";
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m > 0 && s > 0) return `${m}min ${s}s`;
  if (m > 0) return `${m}min`;
  return `${s}s`;
}

function totalCiclo(b: Bancada) {
  return (
    (b.config?.tempo_injecao_segundos ?? 0) +
    (b.config?.tempo_pausa_segundos ?? 0) +
    (b.config?.tempo_retorno_segundos ?? 0)
  );
}


function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return { r: 34, g: 197, b: 94 };
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function gerarRelatorioPdf(salasComBancadas: SalaComBancadas[]) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const addPageIfNeeded = (height: number) => {
    if (y + height <= pageHeight - margin) return;
    doc.addPage();
    y = margin;
  };

  doc.setProperties({ title: "Relatorio de Ciclos" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Relatórios de Ciclos", margin, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text("Programação atual das bancadas de cada sala bioreator.", margin, y);
  y += 9;
  doc.setTextColor(0, 0, 0);

  salasComBancadas.forEach(({ lab, bancadas }, salaIndex) => {
    const labColor = hexToRgb(lab.cor || "#22c55e");
    addPageIfNeeded(22);
    if (salaIndex > 0 && y > margin + 20) y += 2;

    doc.setFillColor(labColor.r, labColor.g, labColor.b);
    doc.rect(margin, y, contentWidth, 2, "F");
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`${lab.nome} — ${bancadas.length} bancada${bancadas.length === 1 ? "" : "s"}`, margin, y);
    y += 7;
    if (lab.descricao) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(90, 90, 90);
      doc.text(lab.descricao, margin, y);
      doc.setTextColor(0, 0, 0);
      y += 5;
    }

    bancadas.forEach((b) => {
      const c = b.config ?? {
        tempo_injecao_segundos: 0,
        tempo_pausa_segundos: 0,
        tempo_retorno_segundos: 0,
        tempo_alivio_segundos: 0,
        horarios_disparo: [] as string[],
      };
      const horarios = Array.isArray(c.horarios_disparo) ? c.horarios_disparo : [];
      const horarioTexto = horarios.length > 0 ? horarios.join(", ") : "Nenhum horário programado";
      const horarioLinhas = doc.splitTextToSize(horarioTexto, contentWidth - 10) as string[];
      const infoLinhas = [
        `Status: ${b.status}`,
        b.firmware_version ? `Firmware: ${b.firmware_version}${b.ip_local ? ` · ${b.ip_local}` : ""}` : null,
        `Injeção: ${fmtSegundos(c.tempo_injecao_segundos)}   Pausa: ${fmtSegundos(c.tempo_pausa_segundos)}`,
        `Retorno: ${fmtSegundos(c.tempo_retorno_segundos)}`,

        `Duração total: ${fmtSegundos(totalCiclo(b))}`,
        `Horários de disparo: ${horarioLinhas[0] ?? ""}`,
        ...horarioLinhas.slice(1).map((linha) => `  ${linha}`),
        b.temp_min !== null || b.temp_max !== null
          ? `Faixa de temperatura: ${b.temp_min ?? "-"}°C … ${b.temp_max ?? "-"}°C`
          : null,
      ].filter(Boolean) as string[];
      const cardHeight = 13 + infoLinhas.length * 4.4;

      addPageIfNeeded(cardHeight + 4);
      doc.setDrawColor(220, 226, 232);
      doc.setFillColor(250, 250, 250);
      doc.roundedRect(margin, y, contentWidth, cardHeight, 1.5, 1.5, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(b.nome, margin + 5, y + 7);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      infoLinhas.forEach((linha, index) => {
        doc.text(linha, margin + 5, y + 12 + index * 4.4);
      });
      y += cardHeight + 4;
    });
  });

  doc.save(PDF_FILENAME);
}

function RelatoriosPage() {
  const [labs, setLabs] = useState<Laboratorio[]>([]);
  const [bancadas, setBancadas] = useState<Bancada[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [labsRes, bancadasRes] = await Promise.all([
        supabase
          .from("laboratorios")
          .select("*")
          .order("ordem", { ascending: true }),
        supabase
          .from("bancadas")
          .select("*")
          .order("posicao", { ascending: true, nullsFirst: false }),
      ]);
      if (!alive) return;
      setLabs((labsRes.data ?? []) as unknown as Laboratorio[]);
      setBancadas((bancadasRes.data ?? []) as unknown as Bancada[]);
      setLoading(false);
    };
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const salasComBancadas = useMemo(() => {
    const grupos = labs
      .map((lab) => ({
        lab,
        bancadas: bancadas.filter((b) => b.laboratorio_id === lab.id),
      }))
      .filter((g) => g.bancadas.length > 0);

    const semLab = bancadas.filter((b) => !b.laboratorio_id);
    if (semLab.length > 0) {
      grupos.push({
        lab: {
          id: SEM_LAB,
          nome: "Sem sala bioreator",
          descricao: null,
          cor: "#94a3b8",
          ordem: 999,
          created_at: "",
        },
        bancadas: semLab,
      });
    }
    return grupos;
  }, [labs, bancadas]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando relatórios…
      </div>
    );
  }

  if (salasComBancadas.length === 0) {
    return (
      <Card className="card-elevated">
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <FlaskConical className="h-8 w-8 text-muted-foreground" />
          <div className="font-semibold">Nenhuma sala com bancadas</div>
          <p className="text-sm text-muted-foreground">
            Cadastre salas bioreator e vincule bancadas para ver os relatórios.
          </p>
        </CardContent>
      </Card>
    );
  }

  const firstTab = "__todas__";

  return (
    <div className="space-y-4 print-report">
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          html, body { background: white !important; }
          aside, header, nav, [data-sidebar], [role="tablist"] { display: none !important; }
          main { padding: 0 !important; }
          .print-report [role="tabpanel"] { display: block !important; }
          .print-report [role="tabpanel"][hidden] { display: none !important; }
          .print-report .card-elevated { box-shadow: none !important; break-inside: avoid; page-break-inside: avoid; }
          .print-hide, .print-hide * { display: none !important; }
        }
      `}</style>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-primary">
            <FileText className="h-6 w-6" /> Relatórios de Ciclos
          </h1>
          <p className="text-sm text-muted-foreground">
            Programação atual das bancadas de cada sala bioreator.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => gerarRelatorioPdf(salasComBancadas)}
            className="print-hide print:hidden"
          >
            <FileText className="mr-1.5 h-4 w-4" /> Salvar PDF
          </Button>
        </div>
      </div>


      <Tabs defaultValue={firstTab} className="w-full">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="__todas__" className="gap-2">
            Todas
            <Badge variant="secondary" className="ml-1 text-[10px]">
              {bancadas.length}
            </Badge>
          </TabsTrigger>
          {salasComBancadas.map(({ lab, bancadas: bs }) => (
            <TabsTrigger key={lab.id} value={lab.id} className="gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: lab.cor }}
              />
              {lab.nome}
              <Badge variant="secondary" className="ml-1 text-[10px]">
                {bs.length}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="__todas__" className="mt-4 space-y-6">
          {salasComBancadas.map(({ lab, bancadas: bs }) => (
            <SalaRelatorio key={lab.id} lab={lab} bancadas={bs} />
          ))}
        </TabsContent>

        {salasComBancadas.map(({ lab, bancadas: bs }) => (
          <TabsContent key={lab.id} value={lab.id} className="mt-4 space-y-3">
            <SalaRelatorio lab={lab} bancadas={bs} />
          </TabsContent>
        ))}
      </Tabs>
    </div>

  );
}

function SalaRelatorio({
  lab,
  bancadas,
}: {
  lab: Laboratorio;
  bancadas: Bancada[];
}) {
  return (
    <div className="space-y-3 print:break-before-page first:print:break-before-auto">
      <Card className="card-elevated overflow-hidden print:break-inside-avoid print:shadow-none print:border">
        <div className="h-1.5 w-full" style={{ background: lab.cor }} />
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" style={{ color: lab.cor }} />
            {lab.nome}
            <Badge variant="outline" className="ml-1 text-[10px]">
              {bancadas.length} bancada{bancadas.length === 1 ? "" : "s"}
            </Badge>
          </CardTitle>
          {lab.descricao && (
            <p className="text-xs text-muted-foreground">{lab.descricao}</p>
          )}
        </CardHeader>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 print:grid-cols-2">

        {bancadas.map((b) => {
          const c = b.config ?? {
            tempo_injecao_segundos: 0,
            tempo_pausa_segundos: 0,
            tempo_retorno_segundos: 0,
            tempo_alivio_segundos: 0,
            horarios_disparo: [] as string[],
          };
          const horarios = Array.isArray(c.horarios_disparo)
            ? c.horarios_disparo
            : [];
          return (
            <Card key={b.id} className="card-elevated print:break-inside-avoid print:shadow-none print:border">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm font-semibold">
                    {b.nome}
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px]">
                    {b.status}
                  </Badge>
                </div>
                {b.firmware_version && (
                  <p className="text-[10px] text-muted-foreground">
                    Firmware {b.firmware_version}
                    {b.ip_local ? ` · ${b.ip_local}` : ""}
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Programação do ciclo
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Injeção</dt>
                    <dd className="text-right font-mono">
                      {fmtSegundos(c.tempo_injecao_segundos)}
                    </dd>
                    <dt className="text-muted-foreground">Pausa</dt>
                    <dd className="text-right font-mono">
                      {fmtSegundos(c.tempo_pausa_segundos)}
                    </dd>
                    <dt className="text-muted-foreground">Retorno</dt>
                    <dd className="text-right font-mono">
                      {fmtSegundos(c.tempo_retorno_segundos)}
                    </dd>
                    <dt className="text-muted-foreground">Alívio</dt>
                    <dd className="text-right font-mono">
                      {fmtSegundos(c.tempo_alivio_segundos)}
                    </dd>
                    <dt className="border-t pt-1 font-medium">Duração total</dt>
                    <dd className="border-t pt-1 text-right font-mono font-semibold">
                      {fmtSegundos(totalCiclo(b))}
                    </dd>
                  </dl>
                </div>

                <div>
                  <div className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    <Clock className="h-3 w-3" /> Horários de disparo
                  </div>
                  {horarios.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nenhum horário programado
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {horarios.map((h) => (
                        <Badge
                          key={h}
                          variant="secondary"
                          className="font-mono text-[11px]"
                        >
                          {h}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {(b.temp_min !== null || b.temp_max !== null) && (
                  <div className="text-[11px] text-muted-foreground">
                    Faixa de temperatura:{" "}
                    <span className="font-mono">
                      {b.temp_min ?? "-"}°C … {b.temp_max ?? "-"}°C
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
