import { useEffect, useState } from "react";
import { AlertTriangle, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { Bancada, Configuracoes } from "@/lib/types";

interface Props {
  bancada: Bancada | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: number, config: Configuracoes) => void;
}

export function BancadaConfigDialog({
  bancada,
  open,
  onOpenChange,
  onSave,
}: Props) {
  const [config, setConfig] = useState<Configuracoes>({
    intervalo_ciclo_horas: 4,
    tempo_injecao_segundos: 150,
    tempo_pausa_segundos: 60,
    tempo_retorno_segundos: 150,
  });

  useEffect(() => {
    if (bancada) setConfig(bancada.config);
  }, [bancada]);

  if (!bancada) return null;

  const update = (k: keyof Configuracoes, v: string) =>
    setConfig((prev) => ({ ...prev, [k]: Number(v) || 0 }));

  const handleSave = () => {
    // TODO(Supabase):
    //   await supabase.from('configuracoes').update(config).eq('bancada_id', bancada.id)
    onSave(bancada.id, config);
    toast.success(`Configuração salva para ${bancada.nome}`);
    onOpenChange(false);
  };

  const handleForceCycle = () => {
    // TODO(Supabase): publicar comando via tabela 'comandos' ou canal realtime
    //   await supabase.from('comandos').insert({ bancada_id: bancada.id, tipo: 'FORCE_CYCLE' })
    toast.warning(`Ciclo manual disparado em ${bancada.nome}`, {
      description: "Comando enviado ao ESP32.",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configurar {bancada.nome}</DialogTitle>
          <DialogDescription>
            Ajuste os parâmetros do ciclo pneumático deste nó ESP32.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="intervalo">Intervalo do Ciclo (horas)</Label>
            <Input
              id="intervalo"
              type="number"
              min={1}
              value={config.intervalo_ciclo_horas}
              onChange={(e) =>
                update("intervalo_ciclo_horas", e.target.value)
              }
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="inj" className="text-xs">
                Injeção (s)
              </Label>
              <Input
                id="inj"
                type="number"
                min={1}
                value={config.tempo_injecao_segundos}
                onChange={(e) =>
                  update("tempo_injecao_segundos", e.target.value)
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pausa" className="text-xs">
                Pausa (s)
              </Label>
              <Input
                id="pausa"
                type="number"
                min={1}
                value={config.tempo_pausa_segundos}
                onChange={(e) =>
                  update("tempo_pausa_segundos", e.target.value)
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ret" className="text-xs">
                Retorno (s)
              </Label>
              <Input
                id="ret"
                type="number"
                min={1}
                value={config.tempo_retorno_segundos}
                onChange={(e) =>
                  update("tempo_retorno_segundos", e.target.value)
                }
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="destructive" onClick={handleForceCycle}>
            <AlertTriangle className="mr-1.5 h-4 w-4" />
            Forçar Ciclo Manual
          </Button>
          <Button onClick={handleSave}>
            <Save className="mr-1.5 h-4 w-4" />
            Salvar Configuração
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
