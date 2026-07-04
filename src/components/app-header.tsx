import { useNavigate } from "@tanstack/react-router";
import { LogOut, Server, Moon, Sun, User } from "lucide-react";
import { useEffect, useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export function AppHeader() {
  const navigate = useNavigate();
  const [dark, setDark] = useState(false);
  const [connected] = useState(true);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Sessão encerrada");
    navigate({ to: "/login" });
  };

  const iniciais = (email ?? "?").split(/[@.]/)[0].slice(0, 2).toUpperCase();
  const nomeExibicao = email ? email.split("@")[0] : null;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-3 backdrop-blur">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-6" />

      <div className="flex items-center gap-2">
        <div className="relative">
          <Server className="h-4 w-4 text-muted-foreground" />
          <span
            className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-background ${
              connected ? "bg-leaf animate-pulse" : "bg-destructive"
            }`}
          />
        </div>
        <div className="text-xs">
          <div className="font-medium">
            Servidor {connected ? "Online" : "Offline"}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">
            mqtt://lab-gateway:1883
          </div>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {email ? (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1">
            <Avatar className="h-6 w-6">
              <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                {iniciais}
              </AvatarFallback>
            </Avatar>
            <div className="hidden min-w-0 sm:block">
              <div className="max-w-[160px] truncate text-xs font-medium leading-tight">
                {nomeExibicao}
              </div>
              <div className="max-w-[160px] truncate text-[10px] leading-tight text-muted-foreground">
                {email}
              </div>
            </div>
          </div>
        ) : (
          <div className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <User className="h-3.5 w-3.5" /> não autenticado
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDark((d) => !d)}
          aria-label="Alternar tema"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        {email ? (
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="mr-1.5 h-4 w-4" />
            Sair
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/login" })}>
            Entrar
          </Button>
        )}
      </div>
    </header>
  );
}
