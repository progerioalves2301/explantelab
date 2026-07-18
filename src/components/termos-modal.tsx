import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

const VERSAO_TERMOS = "1.0";

export function TermosModal() {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [aceito, setAceito] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) return;
      setUserId(uid);
      const { data: aceites } = await supabase
        .from("termos_aceites")
        .select("versao")
        .eq("user_id", uid)
        .eq("versao", VERSAO_TERMOS)
        .maybeSingle();
      if (!aceites) setOpen(true);
    })();
  }, []);

  const handleAceitar = async () => {
    if (!userId || !aceito) return;
    setSalvando(true);
    const { error } = await supabase
      .from("termos_aceites")
      .insert({ user_id: userId, versao: VERSAO_TERMOS });
    if (error) {
      toast.error("Erro ao registrar aceite: " + error.message);
      setSalvando(false);
      return;
    }
    toast.success("Termos aceitos. Bem-vindo à VitroCeres!");
    setOpen(false);
    setSalvando(false);
  };

  const handleRecusar = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <Dialog open={open} onOpenChange={() => { /* bloqueado */ }}>
      <DialogContent
        className="max-w-2xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Termos de Uso e Política de Privacidade
          </DialogTitle>
          <DialogDescription>
            Antes de continuar, precisamos do seu aceite (LGPD — Lei 13.709/2018).
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-64 rounded border p-4 text-sm">
          <p className="mb-2 font-semibold">VitroCeres — Resumo</p>
          <p className="mb-2">
            A VitroCeres coleta e trata os seguintes dados pessoais: e-mail,
            identificador de usuário, papel de acesso, registros de auditoria
            (ações realizadas no sistema) e histórico de comandos emitidos.
          </p>
          <p className="mb-2">
            <strong>Finalidade:</strong> operar o sistema de automação de
            prateleiras de cultivo in vitro, controlar dispositivos ESP32,
            registrar histórico e cumprir obrigações legais.
          </p>
          <p className="mb-2">
            <strong>Base legal:</strong> execução de contrato, legítimo
            interesse e cumprimento de obrigação legal (art. 7º, LGPD).
          </p>
          <p className="mb-2">
            <strong>Seus direitos (art. 18):</strong> acesso, correção,
            portabilidade, eliminação, informação e revogação de consentimento.
            Disponíveis em <em>Privacidade e meus dados</em>.
          </p>
          <p className="mb-2">
            <strong>Retenção:</strong> medições de temperatura por 90 dias;
            auditoria mantida para cumprimento legal; conta excluída sob
            solicitação.
          </p>
          <p className="mb-2">
            <strong>Segurança:</strong> RLS no banco, TLS com CA pinning,
            senhas fortes com verificação HIBP, rate limiting e auditoria.
          </p>
          <p>
            Texto completo em{" "}
            <a href="/privacidade" target="_blank" className="underline">
              /privacidade
            </a>
            .
          </p>
        </ScrollArea>

        <div className="flex items-start gap-2 pt-2">
          <Checkbox
            id="aceite"
            checked={aceito}
            onCheckedChange={(v) => setAceito(v === true)}
          />
          <label htmlFor="aceite" className="text-sm leading-tight">
            Li e concordo com os Termos de Uso e a Política de Privacidade da
            VitroCeres (versão {VERSAO_TERMOS}).
          </label>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={handleRecusar} disabled={salvando}>
            Recusar e sair
          </Button>
          <Button onClick={handleAceitar} disabled={!aceito || salvando}>
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Aceitar e continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
