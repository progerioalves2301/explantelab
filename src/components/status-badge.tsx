import { cn } from "@/lib/utils";
import type { BancadaStatus } from "@/lib/types";

const styles: Record<BancadaStatus, string> = {
  Injetando: "bg-leaf text-leaf-foreground",
  Retornando: "bg-fluid text-fluid-foreground",
  Alivio: "bg-warn text-warn-foreground",
  Repouso: "bg-idle text-idle-foreground",
  Pausado: "bg-warn text-warn-foreground",
  Manual: "bg-primary text-primary-foreground",
  Offline: "bg-destructive text-destructive-foreground",
};

export function StatusBadge({ status }: { status: BancadaStatus }) {
  const pulse = status === "Injetando" || status === "Retornando";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        styles[status],
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full bg-current",
          pulse && "animate-pulse",
        )}
      />
      {status}
    </span>
  );
}
