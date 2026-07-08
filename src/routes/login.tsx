import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import logoVitroCeres from "@/assets/vitroceres-logo.asset.json";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Login — VitroCeres OS" },
      { name: "description", content: "Acesso restrito aos técnicos do sala bioreator." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard` },
        });
        if (error) throw error;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("Bem-vindo(a)");
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao autenticar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="rounded-xl bg-white px-6 py-4 shadow-lg ring-1 ring-border">
            <img
              src={logoVitroCeres.url}
              alt="VitroCeres OS by Explante Biotecnologia"
              className="h-[78px] w-auto object-contain"
            />
          </div>
          <p className="text-xs text-muted-foreground">Acesso restrito</p>
        </div>

        <Card className="card-elevated">
          <CardHeader>
            <CardTitle>Entrar</CardTitle>
            <CardDescription>Use suas credenciais do sala bioreator.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="tecnico@genelab.io"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {mode === "signup" ? "Criar conta e entrar" : "Entrar"}
              </Button>
              <button
                type="button"
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                className="text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                {mode === "signin"
                  ? "Primeiro acesso? Criar conta"
                  : "Já tenho conta — entrar"}
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
