import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { DEFAULT_CONFIG, type Configuracoes } from "@/lib/types";

export const Route = createFileRoute("/_shell/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — GeneLab IoT" },
      { name: "description", content: "Parâmetros padrão do ciclo pneumático." },
    ],
  }),
  component: ConfigPage,
});

function ConfigPage() {
  const [config, setConfig] = useState<Configuracoes>(DEFAULT_CONFIG);

  const update = (k: keyof Configuracoes, v: string) =>
    setConfig((prev) => ({ ...prev, [k]: Number(v) || 0 }));

  const handleSave = () => {
    // Config global padrão — aplicada a novas bancadas. Cada bancada tem sua
    // própria config editável no diálogo (dashboard).
    if (typeof window !== "undefined") {
      window.localStorage.setItem("genelab.default_config", JSON.stringify(config));
    }
    toast.success("Padrão salvo neste navegador");
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Preset padrão do ciclo. Cada bancada mantém sua própria config no dashboard.
        </p>
      </div>

      <Card className="card-elevated">
        <CardHeader>
          <CardTitle>Ciclo pneumático padrão</CardTitle>
          <CardDescription>
            Repouso → Injeção (V1+V4) → Pausa → Retorno (V2+V3) → Alívio (V5).
            Horários de disparo são definidos por bancada no dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field id="inj" label="Injeção (s)" value={config.tempo_injecao_segundos}
              onChange={(v) => update("tempo_injecao_segundos", v)} />
            <Field id="pausa" label="Pausa (s)" value={config.tempo_pausa_segundos}
              onChange={(v) => update("tempo_pausa_segundos", v)} />
            <Field id="ret" label="Retorno (s)" value={config.tempo_retorno_segundos}
              onChange={(v) => update("tempo_retorno_segundos", v)} />
            <Field id="al" label="Alívio (s)" value={config.tempo_alivio_segundos}
              onChange={(v) => update("tempo_alivio_segundos", v)} />
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSave}>
              <Save className="mr-1.5 h-4 w-4" />
              Salvar padrão
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  id, label, value, onChange,
}: {
  id: string; label: string; value: number; onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" min={0} value={value}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
