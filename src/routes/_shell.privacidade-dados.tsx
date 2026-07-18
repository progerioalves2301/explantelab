import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Download, Trash2, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { toast } from "sonner";
import { exportarMeusDados, excluirMinhaConta } from "@/lib/lgpd.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_shell/privacidade-dados")({
  component: PrivacidadeDadosPage,
});

function PrivacidadeDadosPage() {
  const exportar = useServerFn(exportarMeusDados);
  const excluir = useServerFn(excluirMinhaConta);
  const [exportando, setExportando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  const handleExportar = async () => {
    setExportando(true);
    try {
      const dados = await exportar();
      const blob = new Blob([JSON.stringify(dados, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vitroceres_meus_dados_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Dados exportados com sucesso");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao exportar");
    } finally {
      setExportando(false);
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
            Baixe um arquivo JSON com todos os dados pessoais associados à sua
            conta: identificação, papéis, histórico de aceites de termos e
            operações registradas no sistema em seu nome.
          </p>
          <Button onClick={handleExportar} disabled={exportando}>
            {exportando ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Exportar meus dados (JSON)
          </Button>
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
