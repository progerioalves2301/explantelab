import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Check, Copy, KeyRound } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarBancada } from "@/lib/bancadas.functions";
import type { Bancada } from "@/lib/types";

export const Route = createFileRoute("/_shell/bancadas/nova")({
  head: () => ({
    meta: [
      { title: "Nova bancada — GeneLab IoT" },
      {
        name: "description",
        content:
          "Cadastro de uma nova bancada ESP32 — pareamento por código de 6 dígitos.",
      },
    ],
  }),
  component: NovaBancadaPage,
});

function NovaBancadaPage() {
  const criar = useServerFn(criarBancada);
  const [nome, setNome] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    bancada: Bancada;
    pairing_code: string;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await criar({ data: { nome } });
      setResult(r);
      toast.success("Bancada criada. Use o código de 6 dígitos no ESP32.");
    } catch (err) {
      toast.error("Falha ao criar", { description: String(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/dashboard">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Voltar
          </Link>
        </Button>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Nova bancada</h1>
        <p className="text-sm text-muted-foreground">
          Cadastre a bancada e digite o código de 6 dígitos no portal Wi-Fi do ESP32.
        </p>
      </div>

      {!result ? (
        <Card className="card-elevated">
          <CardHeader>
            <CardTitle>Identificação</CardTitle>
            <CardDescription>Dê um nome para localizar no dashboard.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="nome">Nome</Label>
                <Input
                  id="nome"
                  placeholder="Bancada 01 — Estufa A"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  minLength={2}
                  maxLength={60}
                  required
                />
              </div>
              <Button type="submit" disabled={loading}>
                {loading ? "Criando…" : "Criar bancada e gerar código"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Provisioning result={result} />
      )}
    </div>
  );
}

function Provisioning({
  result,
}: {
  result: { bancada: Bancada; pairing_code: string };
}) {
  const [copied, setCopied] = useState(false);
  const copyCode = async () => {
    await navigator.clipboard.writeText(result.pairing_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-4">
      <Card className="card-elevated border-primary/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            Código de pareamento
          </CardTitle>
          <CardDescription>
            Válido por 24h. Use uma única vez — depois de pareado, o ESP32
            guarda o token e o código deixa de funcionar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border bg-muted/30 p-6">
            <span className="font-mono text-4xl font-bold tracking-[0.4em]">
              {result.pairing_code}
            </span>
            <Button variant="outline" size="icon" onClick={copyCode} aria-label="Copiar código">
              {copied ? <Check className="h-4 w-4 text-leaf" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>

          <div>
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Bancada
            </Label>
            <p className="mt-1 text-sm">{result.bancada.nome}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="card-elevated">
        <CardHeader>
          <CardTitle>Como parear o ESP32</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="ml-4 list-decimal space-y-2 text-sm text-muted-foreground">
            <li>
              Ligue a bancada. Ela sobe a rede Wi-Fi{" "}
              <code className="rounded bg-muted px-1 font-mono">BancadaSetup</code>{" "}
              (senha <code className="rounded bg-muted px-1 font-mono">1234567890</code>).
            </li>
            <li>
              Conecte pelo celular/notebook. O portal captivo abre sozinho — se
              não abrir, acesse{" "}
              <code className="rounded bg-muted px-1 font-mono">http://192.168.4.1</code>.
            </li>
            <li>Selecione o Wi-Fi do laboratório e informe a senha.</li>
            <li>
              No campo <strong>Código de pareamento</strong>, digite os 6 dígitos
              acima.
            </li>
            <li>
              Salve. O ESP32 conecta, troca o código pelas credenciais e aparece
              como <strong>“{result.bancada.nome}”</strong> no dashboard em segundos.
            </li>
          </ol>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button asChild variant="outline">
          <Link to="/dashboard">Ir para o dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
