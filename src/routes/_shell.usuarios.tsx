import { createFileRoute } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_shell/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuários — GeneLab IoT" },
      { name: "description", content: "Gerencie os técnicos com acesso ao laboratório." },
    ],
  }),
  component: UsersPage,
});

// TODO(Supabase): substituir por supabase.from('profiles').select('*')
const MOCK_USERS = [
  { id: 1, nome: "Ana Ferreira", email: "ana@genelab.io", role: "Admin" },
  { id: 2, nome: "Bruno Costa", email: "bruno@genelab.io", role: "Técnico" },
  { id: 3, nome: "Carla Menezes", email: "carla@genelab.io", role: "Técnico" },
  { id: 4, nome: "Diego Rocha", email: "diego@genelab.io", role: "Leitor" },
];

function UsersPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usuários</h1>
          <p className="text-sm text-muted-foreground">
            Técnicos com acesso ao painel de controle.
          </p>
        </div>
        <Button>
          <UserPlus className="mr-1.5 h-4 w-4" />
          Convidar
        </Button>
      </div>

      <Card className="card-elevated">
        <CardHeader>
          <CardTitle className="text-base">Membros da equipe</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {MOCK_USERS.map((u) => (
            <div key={u.id} className="flex items-center gap-3 py-3">
              <Avatar>
                <AvatarFallback className="bg-primary/10 text-primary">
                  {u.nome
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{u.nome}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {u.email}
                </div>
              </div>
              <Badge variant={u.role === "Admin" ? "default" : "secondary"}>
                {u.role}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
