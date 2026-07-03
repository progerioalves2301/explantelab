import { useNavigate } from "@tanstack/react-router";
import { LogOut, Server, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

export function AppHeader() {
  const navigate = useNavigate();
  const [dark, setDark] = useState(false);
  const [connected] = useState(true); // TODO(Supabase): substituir por status do canal realtime

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const handleLogout = async () => {
    // TODO(Supabase): await supabase.auth.signOut()
    toast.success("Sessão encerrada");
    navigate({ to: "/login" });
  };

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

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDark((d) => !d)}
          aria-label="Alternar tema"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          <LogOut className="mr-1.5 h-4 w-4" />
          Sair
        </Button>
      </div>
    </header>
  );
}
