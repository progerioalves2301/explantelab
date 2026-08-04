import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Database, Download, Loader2, ShieldAlert } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  exportarTabela,
  COLUNA_DATA,
  TABELAS_SENSIVEIS,
  type CelulaCsv,
  type TabelaExportavel,
} from "@/lib/exportacao.functions";

export const Route = createFileRoute("/_shell/dados")({
  head: () => ({
    meta: [
      { title: "Dados e exportação — VitroCeres" },
      {
        name: "description",
        content:
          "Exporte em CSV os dados de prateleiras, medições, alertas e auditoria do VitroCeres.",
      },
      { property: "og:title", content: "Dados e exportação — VitroCeres" },
      {
        property: "og:description",
        content:
          "Baixe em CSV os registros do sistema VitroCeres para análise externa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DadosPage,
});

const TABELAS: { key: TabelaExportavel; label: string; descricao: string }[] = [
  { key: "bancadas", label: "Prateleiras", descricao: "Cadastro, estado atual e configuração de ciclo." },
  { key: "laboratorios", label: "Salas bioreator", descricao: "Cadastro das salas." },
  { key: "mudas", label: "Mudas", descricao: "Identificação, espécie e período de cultivo." },
  { key: "medicoes_temperatura", label: "Medições de temperatura", descricao: "Histórico minuto a minuto por prateleira." },
  { key: "medicoes_peso", label: "Medições de peso", descricao: "Leituras da balança por muda." },
  { key: "medicoes_co2", label: "Medições de CO₂", descricao: "Leituras em ppm por sala." },
  { key: "alertas", label: "Alertas", descricao: "Offline, temperatura e falhas de ciclo." },
  { key: "comandos", label: "Comandos", descricao: "Comandos enviados às prateleiras." },
  { key: "auditoria", label: "Auditoria", descricao: "Trilha de alterações com usuário e e-mail." },
];

function csvEscape(v: CelulaCsv): string {
  if (v === null) return "";
  const s = String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function DadosPage() {
  const exportar = useServerFn(exportarTabela);
  const [dias, setDias] = useState<string>("30");
  const [carregando, setCarregando] = useState<TabelaExportavel | null>(null);

  const baixar = async (tabela: TabelaExportavel) => {
    try {
      setCarregando(tabela);
      const res = await exportar({
        data: { tabela, dias: Number(dias) as 7 | 30 | 90 | 0 },
      });
      if (res.linhas.length === 0) {
        toast.info("Nenhum registro no período selecionado");
        return;
      }
      const csv = [
        res.colunas.join(","),
        ...res.linhas.map((l) => l.map(csvEscape).join(",")),
      ].join("\n");
      const blob = new Blob([`\uFEFF${csv}`], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${tabela}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        `${res.linhas.length} registros exportados${res.truncado ? " (limite de 50.000 atingido)" : ""}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao exportar");
    } finally {
      setCarregando(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dados e exportação</h1>
          <p className="text-sm text-muted-foreground">
            Baixe os registros do sistema em CSV para análise externa.
          </p>
        </div>
        <div className="w-[190px]">
          <Select value={dias} onValueChange={setDias}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
              <SelectItem value="0">Tudo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="card-elevated">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-primary" />
            LGPD
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Exportações de tabelas com dados pessoais (auditoria) ficam registradas
          na trilha de auditoria, com usuário e data. Arquivos baixados são de sua
          responsabilidade como controlador dos dados.
        </CardContent>
      </Card>

      <Card className="card-elevated">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-primary" />
            Tabelas disponíveis
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {TABELAS.map((t) => {
            const semHistorico = COLUNA_DATA[t.key] === null;
            return (
              <div key={t.key} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {t.label}
                    {semHistorico && (
                      <Badge variant="outline" className="text-[10px]">
                        exporta tudo
                      </Badge>
                    )}
                    {TABELAS_SENSIVEIS.includes(t.key) && (
                      <Badge variant="secondary" className="text-[10px]">
                        dados pessoais
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t.descricao}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void baixar(t.key)}
                  disabled={carregando !== null}
                >
                  {carregando === t.key ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-1.5 h-4 w-4" />
                  )}
                  Baixar CSV
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
