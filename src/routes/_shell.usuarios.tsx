import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { UserPlus, Shield, ShieldCheck, Eye, Trash2, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  concederPapel,
  listarUsuarios,
  removerPapel,
  type AppRole,
  type UsuarioComPapeis,
} from "@/lib/roles.functions";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_shell/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuários — Explante" },
      {
        name: "description",
        content:
          "Gerencie os técnicos e administradores com acesso ao painel Explante.",
      },
    ],
  }),
  component: UsersPage,
});

const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Administrador",
  operador: "Operador",
  visualizador: "Visualizador",
};

const ROLE_ICON: Record<AppRole, typeof Shield> = {
  admin: ShieldCheck,
  operador: Shield,
  visualizador: Eye,
};

function UsersPage() {
  const listar = useServerFn(listarUsuarios);
  const conceder = useServerFn(concederPapel);
  const remover = useServerFn(removerPapel);
  const [usuarios, setUsuarios] = useState<UsuarioComPapeis[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [semSessao, setSemSessao] = useState(false);

  const carregar = async () => {
    try {
      setLoading(true);
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        setSemSessao(true);
        setUsuarios([]);
        setErro(null);
        return;
      }
      setSemSessao(false);
      const dados = await listar();
      setUsuarios(dados);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar usuários");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void carregar();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void carregar();
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConceder = async (user_id: string, role: AppRole) => {
    try {
      await conceder({ data: { user_id, role } });
      toast.success(`Papel "${ROLE_LABEL[role]}" concedido`);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao conceder");
    }
  };

  const handleRemover = async (user_id: string, role: AppRole) => {
    try {
      await remover({ data: { user_id, role } });
      toast.success(`Papel "${ROLE_LABEL[role]}" removido`);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usuários</h1>
          <p className="text-sm text-muted-foreground">
            Administradores, operadores e visualizadores com acesso ao painel.
          </p>
        </div>
        <Button variant="outline" disabled title="Envie o link /login para o técnico se cadastrar">
          <UserPlus className="mr-1.5 h-4 w-4" />
          Convidar (em breve)
        </Button>
      </div>

      <Card className="card-elevated">
        <CardHeader>
          <CardTitle className="text-base">Papéis do sistema</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3 text-sm">
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheck className="h-4 w-4 text-primary" /> Administrador
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Gerencia salas bioreator, prateleiras, usuários e configurações globais.
            </p>
          </div>
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 font-medium">
              <Shield className="h-4 w-4 text-primary" /> Operador
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Controla ciclos manuais e monitora prateleiras do dia a dia.
            </p>
          </div>
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 font-medium">
              <Eye className="h-4 w-4 text-primary" /> Visualizador
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Somente leitura. Ideal para gestores e auditoria.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="card-elevated">
        <CardHeader>
          <CardTitle className="text-base">Membros da equipe</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : semSessao ? (
            <div className="space-y-2 py-6 text-sm">
              <div>Você precisa entrar para gerenciar usuários.</div>
              <Link to="/login" className="inline-block text-primary underline">
                Ir para o login
              </Link>
            </div>
          ) : erro ? (
            <div className="py-6 text-sm text-destructive">{erro}</div>
          ) : usuarios.length === 0 ? (
            <div className="py-6 text-sm text-muted-foreground">
              Nenhum usuário cadastrado ainda.
            </div>
          ) : (
            usuarios.map((u) => (
              <UsuarioRow
                key={u.user_id}
                usuario={u}
                onConceder={(role) => handleConceder(u.user_id, role)}
                onRemover={(role) => handleRemover(u.user_id, role)}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UsuarioRow({
  usuario,
  onConceder,
  onRemover,
}: {
  usuario: UsuarioComPapeis;
  onConceder: (role: AppRole) => void;
  onRemover: (role: AppRole) => void;
}) {
  const iniciais = (usuario.email ?? "?")
    .split(/[@.]/)[0]
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <Avatar>
        <AvatarFallback className="bg-primary/10 text-primary">
          {iniciais}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {usuario.email ?? "(sem email)"}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {usuario.roles.length === 0 ? (
            <Badge variant="outline" className="text-[10px]">
              sem papel
            </Badge>
          ) : (
            usuario.roles.map((role) => {
              const Icon = ROLE_ICON[role];
              return (
                <Badge
                  key={role}
                  variant={role === "admin" ? "default" : "secondary"}
                  className="gap-1"
                >
                  <Icon className="h-3 w-3" />
                  {ROLE_LABEL[role]}
                  <button
                    type="button"
                    onClick={() => onRemover(role)}
                    className="ml-1 opacity-70 transition-opacity hover:opacity-100"
                    aria-label={`Remover papel ${ROLE_LABEL[role]}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })
          )}
        </div>
      </div>
      <Select
        onValueChange={(role) => onConceder(role as AppRole)}
        value=""
      >
        <SelectTrigger className="h-8 w-[160px] text-xs">
          <SelectValue placeholder="+ Conceder papel" />
        </SelectTrigger>
        <SelectContent>
          {(["admin", "operador", "visualizador"] as AppRole[])
            .filter((r) => !usuario.roles.includes(r))
            .map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABEL[r]}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}
