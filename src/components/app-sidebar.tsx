import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  LayoutDashboard,
  Settings,
  Users,
  PlusCircle,
  FlaskConical,
  Bell,
  FileText,
  DownloadCloud,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import logoVitroCeres from "@/assets/vitroceres-logo.asset.json";
import { meusPapeis } from "@/lib/roles.functions";
import { supabase } from "@/integrations/supabase/client";

type Item = { title: string; url: string; icon: typeof LayoutDashboard; adminOnly?: boolean };

const items: readonly Item[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Salas Bioreator", url: "/laboratorios", icon: FlaskConical },
  { title: "Nova bancada", url: "/bancadas/nova", icon: PlusCircle },
  { title: "Alertas", url: "/alertas", icon: Bell },
  { title: "Relatórios", url: "/relatorios", icon: FileText },
  { title: "Configurações", url: "/configuracoes", icon: Settings },
  { title: "Usuários", url: "/usuarios", icon: Users },
  { title: "Atualização", url: "/atualizacao", icon: DownloadCloud, adminOnly: true },
] as const;

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const meus = useServerFn(meusPapeis);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancel = false;
    const check = async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) {
          if (!cancel) setIsAdmin(false);
          return;
        }
        const roles = await meus();
        if (!cancel) setIsAdmin(roles.includes("admin"));
      } catch {
        if (!cancel) setIsAdmin(false);
      }
    };
    void check();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") void check();
    });
    return () => {
      cancel = true;
      sub.subscription.unsubscribe();
    };
  }, [meus]);

  const visible = items.filter((i) => !i.adminOnly || isAdmin);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <div className="flex items-center gap-2 px-2 py-1.5">
          {collapsed ? (
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white ring-1 ring-border">
              <span className="font-display text-base font-bold text-primary">V</span>
            </div>
          ) : (
            <div className="flex min-w-0 flex-col gap-0.5">
              <img
                src={logoVitroCeres.url}
                alt="VitroCeres OS by Explante Biotecnologia"
                className="h-8 w-auto object-contain"
              />
              <div className="truncate text-[10px] text-muted-foreground">
                Monitoramento de Bio Reatores
              </div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operação</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visible.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.url}
                    tooltip={item.title}
                  >
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
