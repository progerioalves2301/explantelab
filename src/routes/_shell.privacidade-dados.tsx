import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  Download,
  Trash2,
  ShieldCheck,
  Loader2,
  Link2,
  History,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  exportarMeusDados,
  excluirMinhaConta,
  gerarLinkTransferencia,
  listarMinhasSolicitacoes,
  type SolicitacaoLgpd,
  type DadosPessoaisExport,
} from "@/lib/lgpd.functions";
import { supabase } from "@/integrations/supabase/client";
import jsPDF from "jspdf";

export const Route = createFileRoute("/_shell/privacidade-dados")({
  component: PrivacidadeDadosPage,
});

type Formato = "json" | "csv" | "pdf";

function baixarBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCSV(dados: DadosPessoaisExport): string {
  const linhas: string[] = [];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  linhas.push("secao;campo;valor");
  linhas.push(`titular;user_id;${esc(dados.titular.user_id)}`);
  linhas.push(`titular;email;${esc(dados.titular.email)}`);
  linhas.push(`titular;criado_em;${esc(dados.titular.criado_em)}`);
  linhas.push(`titular;ultimo_login;${esc(dados.titular.ultimo_login)}`);
  linhas.push("");
  linhas.push("papeis;role");
  dados.papeis.forEach((p) => linhas.push(`papeis;${esc(p.role)}`));
  linhas.push("");
  linhas.push("termos_aceites;versao;aceito_em");
  dados.termos_aceites.forEach((t) =>
    linhas.push(`termos;${esc(t.versao)};${esc(t.aceito_em)}`),
  );
  linhas.push("");
  linhas.push("auditoria;tabela;operacao;registro_id;criado_em");
  dados.auditoria_registros_do_titular.forEach((a) =>
    linhas.push(
      `auditoria;${esc(a.tabela)};${esc(a.operacao)};${esc(a.registro_id)};${esc(a.criado_em)}`,
    ),
  );
  linhas.push("");
  linhas.push("comandos;bancada_id;tipo;criado_em");
  dados.comandos_emitidos.forEach((c) =>
    linhas.push(
      `comandos;${esc(c.bancada_id)};${esc(c.tipo)};${esc(c.criado_em)}`,
    ),
  );
  return linhas.join("\n");
}

function toPDF(dados: DadosPessoaisExport): Blob {
  const doc = new jsPDF();
  const marginX = 14;
  let y = 18;
  const lineH = 6;

  const addLine = (txt: string, size = 10, bold = false) => {
    if (y > 280) {
      doc.addPage();
      y = 18;
    }
    doc.setFontSize(size);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(txt, marginX, y);
    y += lineH;
  };

  addLine("Relatório LGPD — Dados Pessoais do Titular", 14, true);
  addLine(`Gerado em: ${new Date(dados.gerado_em).toLocaleString("pt-BR")}`, 9);
  y += 2;

  addLine("Titular", 12, true);
  addLine(`ID: ${dados.titular.user_id}`);
  addLine(`E-mail: ${dados.titular.email ?? "-"}`);
  addLine(`Criado em: ${dados.titular.criado_em ?? "-"}`);
  addLine(`Último login: ${dados.titular.ultimo_login ?? "-"}`);
  y += 2;

  addLine(`Papéis (${dados.papeis.length})`, 12, true);
  dados.papeis.forEach((p) => addLine(`• ${p.role}`));
  y += 2;

  addLine(`Termos aceitos (${dados.termos_aceites.length})`, 12, true);
  dados.termos_aceites.forEach((t) =>
    addLine(`• v${t.versao} — ${new Date(t.aceito_em).toLocaleString("pt-BR")}`),
  );
  y += 2;

  addLine(
    `Auditoria (${dados.auditoria_registros_do_titular.length} registros)`,
    12,
    true,
  );
  dados.auditoria_registros_do_titular.slice(0, 60).forEach((a) =>
    addLine(
      `• ${new Date(a.criado_em).toLocaleString("pt-BR")} — ${a.operacao} em ${a.tabela}`,
      9,
    ),
  );
  y += 2;

  addLine(`Comandos emitidos (${dados.comandos_emitidos.length})`, 12, true);
  dados.comandos_emitidos.slice(0, 40).forEach((c) =>
    addLine(
      `• ${new Date(c.criado_em).toLocaleString("pt-BR")} — ${c.tipo}`,
      9,
    ),
  );

  return doc.output("blob");
}

function PrivacidadeDadosPage() {
  const exportar = useServerFn(exportarMeusDados);
  const excluir = useServerFn(excluirMinhaConta);
  const gerarLink = useServerFn(gerarLinkTransferencia);
  const listarSol = useServerFn(listarMinhasSolicitacoes);

  const [formato, setFormato] = useState<Formato>("json");
  const [exportando, setExportando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [gerandoLink, setGerandoLink] = useState(false);
  const [linkGerado, setLinkGerado] = useState<{
    url: string;
    expira_em: string;
  } | null>(null);
  const [historico, setHistorico] = useState<SolicitacaoLgpd[]>([]);

  const recarregarHistorico = async () => {
    try {
      const h = await listarSol();
      setHistorico(h);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void recarregarHistorico();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExportar = async () => {
    setExportando(true);
    try {
      const dados = await exportar({ data: { formato } });
      const stamp = new Date().toISOString().slice(0, 10);
      if (formato === "json") {
        baixarBlob(
          new Blob([JSON.stringify(dados, null, 2)], {
            type: "application/json",
          }),
          `vitroceres_meus_dados_${stamp}.json`,
        );
      } else if (formato === "csv") {
        baixarBlob(
          new Blob([toCSV(dados)], { type: "text/csv;charset=utf-8" }),
          `vitroceres_meus_dados_${stamp}.csv`,
        );
      } else {
        baixarBlob(toPDF(dados), `vitroceres_meus_dados_${stamp}.pdf`);
      }
      toast.success("Dados exportados com sucesso");
      await recarregarHistorico();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao exportar");
    } finally {
      setExportando(false);
    }
  };

  const handleGerarLink = async () => {
    setGerandoLink(true);
    try {
      const res = await gerarLink();
      setLinkGerado(res);
      toast.success("Link de transferência gerado (válido 24h)");
      await recarregarHistorico();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar link");
    } finally {
      setGerandoLink(false);
    }
  };

  const handleExcluir = async () => {
    setExcluindo(true);
    try {
      await excluir();
      await supabase.auth.signOut();
      toast.success("Conta excluída");
      window.location.href = "/login";
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir conta");
      setExcluindo(false);
    }
  };

  const copiarLink = () => {
    if (linkGerado) {
      navigator.clipboard.writeText(linkGerado.url);
      toast.success("Link copiado");
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Privacidade e meus dados</h1>
          <p className="text-sm text-muted-foreground">
            Direitos do titular — LGPD (Lei 13.709/2018), art. 18.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Portabilidade dos dados (art. 18, II e V)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Baixe um arquivo com todos os dados pessoais associados à sua conta:
            identificação, papéis, aceites de termos, auditoria e comandos
            emitidos em seu nome.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={formato}
              onValueChange={(v) => setFormato(v as Formato)}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="json">JSON</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleExportar} disabled={exportando}>
              {exportando ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Baixar meus dados
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Transferência a outro controlador (art. 18, V)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Gere um link temporário (válido por 24h) apontando para um arquivo
            JSON com seus dados pessoais. Você pode enviar este link a outro
            controlador para transferir seus dados de forma direta e segura.
          </p>
          <Button onClick={handleGerarLink} disabled={gerandoLink}>
            {gerandoLink ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="mr-2 h-4 w-4" />
            )}
            Gerar link de transferência
          </Button>
          {linkGerado && (
            <div className="rounded-md border bg-muted/40 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                Expira em{" "}
                {new Date(linkGerado.expira_em).toLocaleString("pt-BR")}
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={linkGerado.url}
                  className="flex-1 rounded border bg-background px-2 py-1 text-xs"
                />
                <Button size="sm" variant="outline" onClick={copiarLink}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" />
            Histórico de solicitações (art. 19)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {historico.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma solicitação registrada ainda.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Formato</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historico.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-xs">
                      {new Date(s.created_at).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell className="capitalize">{s.tipo}</TableCell>
                    <TableCell className="uppercase text-xs">
                      {s.formato ?? "-"}
                    </TableCell>
                    <TableCell className="capitalize">{s.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-base text-destructive">
            Excluir minha conta (art. 18, VI)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Exclui permanentemente sua conta, papéis e aceites de termos. Os
            registros de auditoria são preservados de forma anonimizada para
            cumprimento de obrigação legal e regulatória (art. 16, I).
          </p>
          <p className="text-sm text-muted-foreground">
            Se você for o último administrador, será necessário nomear outro
            admin antes.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={excluindo}>
                {excluindo ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Excluir minha conta
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Excluir sua conta VitroCeres?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Esta ação é irreversível. Você perderá acesso ao sistema
                  imediatamente e seus dados pessoais serão eliminados.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleExcluir}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Confirmar exclusão
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Para outros direitos previstos no art. 18 (correção, anonimização,
        oposição, revogação de consentimento), entre em contato pelo canal
        indicado na{" "}
        <a href="/privacidade" className="underline">
          Política de Privacidade
        </a>
        .
      </p>
    </div>
  );
}
