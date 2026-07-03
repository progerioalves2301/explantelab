import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Check, Copy, Wifi } from "lucide-react";
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
          "Cadastro e provisionamento de uma nova bancada ESP32 via portal AP.",
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
    device_token: string;
    server_url: string;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await criar({ data: { nome } });
      setResult(r);
      toast.success("Bancada criada. Copie o token agora — ele só aparece uma vez.");
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
          Cadastre a bancada aqui e depois configure o ESP32 pelo portal Wi-Fi.
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
                {loading ? "Criando…" : "Criar bancada e gerar token"}
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
  result: { bancada: Bancada; device_token: string; server_url: string };
}) {
  const shortId = result.bancada.id.slice(0, 8).toUpperCase();
  const apSSID = `BancadaSetup-${shortId}`;

  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-4">
      <Card className="card-elevated border-primary/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wifi className="h-5 w-5 text-primary" />
            Bancada criada
          </CardTitle>
          <CardDescription>
            Copie estas credenciais e cole no portal AP do ESP32. O token só é
            exibido nesta tela.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <CredField label="Bancada ID" value={result.bancada.id} onCopy={copy} copied={copied} />
          <CredField label="Device Token" value={result.device_token} onCopy={copy} copied={copied} secret />
          <CredField label="Server URL" value={result.server_url} onCopy={copy} copied={copied} />
        </CardContent>
      </Card>

      <Card className="card-elevated">
        <CardHeader>
          <CardTitle>Como provisionar o ESP32</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="ml-4 list-decimal space-y-2 text-sm text-muted-foreground">
            <li>
              Ligue a bancada. Se for a primeira vez (ou você segurou o botão de
              reset por 5 s), o ESP32 sobe o Wi-Fi{" "}
              <code className="rounded bg-muted px-1 font-mono">{apSSID}</code>{" "}
              (senha padrão <code className="rounded bg-muted px-1 font-mono">genelab123</code>).
            </li>
            <li>
              No celular/notebook, conecte-se a essa rede. O portal captivo abre
              sozinho — se não abrir, acesse{" "}
              <code className="rounded bg-muted px-1 font-mono">http://192.168.4.1</code>.
            </li>
            <li>Selecione o Wi-Fi do laboratório e informe a senha.</li>
            <li>
              Nos campos extras do portal, cole o <strong>Bancada ID</strong>,{" "}
              <strong>Device Token</strong> e <strong>Server URL</strong> acima.
            </li>
            <li>
              Salve. O ESP32 reinicia, conecta na sua rede e aparece como{" "}
              <strong>“{result.bancada.nome}”</strong> no dashboard em segundos.
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

function CredField({
  label, value, onCopy, copied, secret,
}: {
  label: string; value: string;
  onCopy: (l: string, v: string) => void;
  copied: string | null; secret?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={value}
          type={secret ? "text" : "text"}
          className="font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => onCopy(label, value)}
          aria-label={`Copiar ${label}`}
        >
          {copied === label ? (
            <Check className="h-4 w-4 text-leaf" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
