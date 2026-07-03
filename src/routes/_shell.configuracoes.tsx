import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Configuracoes } from "@/lib/types";

export const Route = createFileRoute("/_shell/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — GeneLab IoT" },
      { name: "description", content: "Parâmetros globais do ciclo pneumático aplicados a todas as bancadas." },
    ],
  }),
  component: ConfigPage,
});

function ConfigPage() {
  const [config, setConfig] = useState<Configuracoes>({
    intervalo_ciclo_horas: 4,
    tempo_injecao_segundos: 150,
    tempo_pausa_segundos: 60,
    tempo_retorno_segundos: 150,
  });

  const update = (k: keyof Configuracoes, v: string) =>
    setConfig((prev) => ({ ...prev, [k]: Number(v) || 0 }));

  const handleSave = () => {
    // TODO(Supabase): await supabase.from('configuracoes').upsert({ id: 'global', ...config })
    toast.success("Configuração global salva");
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Parâmetros padrão do ciclo aplicados a novas bancadas.
        </p>
      </div>

      <Card className="card-elevated">
        <CardHeader>
          <CardTitle>Ciclo pneumático padrão</CardTitle>
          <CardDescription>
            Repouso → Injeção (V1+V4) → Pausa → Retorno (V2+V3).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="intervalo">Intervalo do Ciclo (horas)</Label>
            <Input
              id="intervalo"
              type="number"
              min={1}
              value={config.intervalo_ciclo_horas}
              onChange={(e) => update("intervalo_ciclo_horas", e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="inj">Injeção (s)</Label>
              <Input
                id="inj"
                type="number"
                value={config.tempo_injecao_segundos}
                onChange={(e) => update("tempo_injecao_segundos", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pausa">Pausa (s)</Label>
              <Input
                id="pausa"
                type="number"
                value={config.tempo_pausa_segundos}
                onChange={(e) => update("tempo_pausa_segundos", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ret">Retorno (s)</Label>
              <Input
                id="ret"
                type="number"
                value={config.tempo_retorno_segundos}
                onChange={(e) => update("tempo_retorno_segundos", e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSave}>
              <Save className="mr-1.5 h-4 w-4" />
              Salvar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
