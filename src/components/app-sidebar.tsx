import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Settings, Users, PlusCircle, FlaskConical, Bell } from "lucide-react";
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
import logoLeaf from "@/assets/explante-leaf.png";

const items = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Salas Bioreator", url: "/laboratorios", icon: FlaskConical },
  { title: "Nova bancada", url: "/bancadas/nova", icon: PlusCircle },
  { title: "Alertas", url: "/alertas", icon: Bell },
  { title: "Configurações", url: "/configuracoes", icon: Settings },
  { title: "Usuários", url: "/usuarios", icon: Users },
] as const;

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white ring-1 ring-border">
            <img src={logoLeaf} alt="Explante Lab" className="h-7 w-7 object-contain" width={28} height={28} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate font-display text-sm font-bold text-primary">
                Explante <span className="italic">Lab</span>
              </div>
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
              {items.map((item) => (
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
