import { Droplet } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ValvulasEstado } from "@/lib/types";

interface Props {
  valvulas: ValvulasEstado;
  mode: "injetando" | "retornando" | "idle";
}

// V1+V4 → injeção (leaf). V2+V3 → retorno (fluid). Inativas → muted.
export function ValveIndicator({ valvulas, mode }: Props) {
  const items: Array<{ key: keyof ValvulasEstado; label: string }> = [
    { key: "v1", label: "V1" },
    { key: "v2", label: "V2" },
    { key: "v3", label: "V3" },
    { key: "v4", label: "V4" },
  ];

  return (
    <div className="grid grid-cols-4 gap-2">
      {items.map(({ key, label }) => {
        const active = valvulas[key];
        const activeClass =
          mode === "injetando"
            ? "valve-active-leaf"
            : mode === "retornando"
              ? "valve-active-fluid"
              : "";
        return (
          <div key={key} className="flex flex-col items-center gap-1">
            <div
              className={cn(
                "grid h-9 w-9 place-items-center rounded-full border transition-colors",
                active
                  ? activeClass
                  : "border-border bg-muted text-muted-foreground",
              )}
              aria-label={`Válvula ${label} ${active ? "aberta" : "fechada"}`}
            >
              <Droplet className="h-4 w-4" />
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
