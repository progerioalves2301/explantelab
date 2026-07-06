import { Droplet, Wind } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ValvulasEstado } from "@/lib/types";

interface Props {
  valvulas: ValvulasEstado;
  mode: "injetando" | "retornando" | "alivio" | "idle";
}

// V1+V4 → Meio (azul). V2+V3 → Planta (verde). V5 → alívio de pressão (warn).
export function ValveIndicator({ valvulas, mode: _mode }: Props) {
  const items: Array<{
    key: keyof ValvulasEstado;
    label: string;
    role: "meio" | "planta" | "relief";
  }> = [
    { key: "v1", label: "Meio", role: "meio" },
    { key: "v2", label: "Planta", role: "planta" },
    { key: "v3", label: "Planta", role: "planta" },
    { key: "v4", label: "Meio", role: "meio" },
    { key: "v5", label: "V5", role: "relief" },
  ];

  return (
    <div className="grid grid-cols-5 gap-2">
      {items.map(({ key, label, role }) => {
        const active = valvulas[key];
        const activeClass =
          role === "relief"
            ? "valve-active-warn"
            : role === "meio"
              ? "valve-active-fluid"
              : "valve-active-leaf";
        const Icon = role === "relief" ? Wind : Droplet;

        return (
          <div key={key} className="flex flex-col items-center gap-1">
            <div
              className={cn(
                "grid h-9 w-9 place-items-center rounded-full border transition-colors",
                active
                  ? activeClass
                  : "border-border bg-muted text-muted-foreground",
              )}
              aria-label={`Válvula ${label} ${active ? "aberta" : "fechada"}${role === "relief" ? " (alívio)" : ""}`}
            >
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-[10px] font-mono text-muted-foreground">
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
