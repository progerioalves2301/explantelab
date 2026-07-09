import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Upload,
  Trash2,
  Loader2,
  Cpu,
  Rocket,
  ShieldAlert,
  FileCode2,
  AlertTriangle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listarFirmwares,
  uploadFirmware,
  deletarFirmware,
  listarBancadasParaOta,
  disparaOtaBancada,
  disparaOtaTodas,
  type FirmwareItem,
  type BancadaFirmwareInfo,
} from "@/lib/atualizacao.functions";
import { meusPapeis } from "@/lib/roles.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_shell/atualizacao")({
  head: () => ({
    meta: [
      { title: "Atualização OTA — Explante" },
      {
        name: "description",
        content:
          "Faça upload de firmware e dispare atualizações OTA para as bancadas ESP32.",
      },
    ],
  }),
  component: AtualizacaoPage,
});

function bytesLegivel(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function AtualizacaoPage() {
  const listarFw = useServerFn(listarFirmwares);
  const uploadFw = useServerFn(uploadFirmware);
  const deletarFw = useServerFn(deletarFirmware);
  const listarBancadas = useServerFn(listarBancadasParaOta);
  const otaOne = useServerFn(disparaOtaBancada);
  const otaAll = useServerFn(disparaOtaTodas);
  const meus = useServerFn(meusPapeis);

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [semSessao, setSemSessao] = useState(false);
  const [firmwares, setFirmwares] = useState<FirmwareItem[]>([]);
  const [bancadas, setBancadas] = useState<BancadaFirmwareInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selecionado, setSelecionado] = useState<string>("");
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const [dispatchingAll, setDispatchingAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Guarda "versão esperada" por bancada após disparar OTA.
  // Quando a telemetria trouxer essa versão, exibe toast de sucesso.
  const [aguardando, setAguardando] = useState<Record<string, string>>({});
  const aguardandoRef = useRef<Record<string, string>>({});
  aguardandoRef.current = aguardando;

  // Extrai "1.9.0" de "bancada_esp32_v1_9_0.ino.bin" (ou similar).
  const extrairVersao = (filename: string): string | null => {
    const m = filename.match(/v(\d+)[._](\d+)[._](\d+)/i);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
  };

  const compararVersoes = (a: string | null, b: string | null) => {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };

  const firmwareMaisNovo = (items = firmwares) =>
    [...items].sort((a, b) => {
      const byVersion = compararVersoes(extrairVersao(b.name), extrairVersao(a.name));
      if (byVersion !== 0) return byVersion;
      return new Date(b.updated_at ?? b.created_at ?? 0).getTime() - new Date(a.updated_at ?? a.created_at ?? 0).getTime();
    })[0];

  const selecionarMaisNovo = (items: FirmwareItem[]) => {
    const latest = firmwareMaisNovo(items)?.name ?? "";
    if (latest) setSelecionado(latest);
  };

  const recarregarBancadas = async () => {
    try {
      const bs = await listarBancadas();
      // Detecta bancadas que atingiram a versão esperada
      const pend = aguardandoRef.current;
      const novoPend = { ...pend };
      let mudou = false;
      for (const b of bs) {
        const esperada = pend[b.id];
        if (esperada && b.firmware_version === esperada) {
          toast.success(`${b.nome} atualizada para v${esperada}.`);
          delete novoPend[b.id];
          mudou = true;
        }
      }
      if (mudou) setAguardando(novoPend);
      setBancadas(bs);
    } catch {
      /* silencioso — poll de fundo */
    }
  };

  const carregar = async () => {
    setLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        setSemSessao(true);
        setIsAdmin(false);
        return;
      }
      setSemSessao(false);
      const roles = await meus();
      const admin = roles.includes("admin");
      setIsAdmin(admin);
      if (!admin) return;
      const [rawFws, bs] = await Promise.all([listarFw(), listarBancadas()]);
      const fws = [...rawFws].sort((a, b) => {
        const byVersion = compararVersoes(extrairVersao(b.name), extrairVersao(a.name));
        if (byVersion !== 0) return byVersion;
        return new Date(b.updated_at ?? b.created_at ?? 0).getTime() - new Date(a.updated_at ?? a.created_at ?? 0).getTime();
      });
      setFirmwares(fws);
      setBancadas(bs);
      if (fws.length > 0) selecionarMaisNovo(fws);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void carregar();
    // Poll a cada 5s p/ refletir nova versão de firmware após OTA.
    const id = setInterval(() => {
      if (isAdmin) void recarregarBancadas();
    }, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const handleUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".bin")) {
      toast.error("Selecione um arquivo .bin");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Firmware muito grande (>4 MB).");
      return;
    }
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      // base64 encode em chunks para evitar stack overflow
      const bytes = new Uint8Array(buf);
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(
          ...bytes.subarray(i, i + CHUNK),
        );
      }
      const base64 = btoa(binary);
      await uploadFw({
        data: {
          filename: file.name,
          base64,
          contentType: "application/octet-stream",
        },
      });
      toast.success(`${file.name} enviado.`);
      if (fileRef.current) fileRef.current.value = "";
      const fws = [...(await listarFw())].sort((a, b) => {
        const byVersion = compararVersoes(extrairVersao(b.name), extrairVersao(a.name));
        if (byVersion !== 0) return byVersion;
        return new Date(b.updated_at ?? b.created_at ?? 0).getTime() - new Date(a.updated_at ?? a.created_at ?? 0).getTime();
      });
      setFirmwares(fws);
      selecionarMaisNovo(fws);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no upload");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Apagar firmware ${name}?`)) return;
    try {
      await deletarFw({ data: { filename: name } });
      toast.success("Firmware apagado.");
      const fws = await listarFw();
      setFirmwares(fws);
      if (selecionado === name) setSelecionado(fws[0]?.name ?? "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao apagar");
    }
  };

  const handleOtaOne = async (bancada_id: string) => {
    if (!selecionado) return toast.error("Selecione um firmware.");
    const maisNovo = firmwareMaisNovo()?.name;
    if (maisNovo && selecionado !== maisNovo) {
      const ok = confirm(
        `Atenção: ${selecionado} não é o firmware mais novo. O mais novo é ${maisNovo}. Deseja continuar mesmo assim?`,
      );
      if (!ok) return;
    }
    setDispatchingId(bancada_id);
    try {
      await otaOne({ data: { bancada_id, filename: selecionado } });
      const versao = extrairVersao(selecionado);
      if (versao) {
        setAguardando((p) => ({ ...p, [bancada_id]: versao }));
      }
      toast.success(
        versao
          ? `Comando OTA enviado. Aguardando bancada reportar v${versao}…`
          : "Comando OTA enviado. A bancada baixará em segundos.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao disparar OTA");
    } finally {
      setDispatchingId(null);
    }
  };

  const handleOtaAll = async () => {
    if (!selecionado) return toast.error("Selecione um firmware.");
    const maisNovo = firmwareMaisNovo()?.name;
    if (maisNovo && selecionado !== maisNovo) {
      const ok = confirm(
        `Atenção: ${selecionado} não é o firmware mais novo. O mais novo é ${maisNovo}. Deseja continuar mesmo assim?`,
      );
      if (!ok) return;
    }
    if (
      !confirm(
        `Disparar OTA (${selecionado}) para TODAS as ${bancadas.length} bancadas?`,
      )
    )
      return;
    setDispatchingAll(true);
    try {
      const r = await otaAll({ data: { filename: selecionado } });
      const versao = extrairVersao(selecionado);
      if (versao) {
        const marca: Record<string, string> = {};
        for (const b of bancadas) marca[b.id] = versao;
        setAguardando((p) => ({ ...p, ...marca }));
      }
      toast.success(
        versao
          ? `OTA enviado para ${r.total} bancada(s). Aguardando reportarem v${versao}…`
          : `OTA enviado para ${r.total} bancada(s).`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao disparar OTA");
    } finally {
      setDispatchingAll(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (semSessao) {
    return (
      <Card>
        <CardContent className="p-6 text-sm">
          Você precisa estar autenticado.{" "}
          <Link to="/login" className="underline">
            Entrar
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" /> Acesso restrito
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Apenas administradores podem publicar atualizações de firmware.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Atualização OTA</h1>
        <p className="text-sm text-muted-foreground">
          Envie firmwares <code>.bin</code> e dispare OTA para as bancadas
          ESP32. O dispositivo baixa via URL assinada (válida 1 h) e reinicia.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm dark:border-amber-400/30">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="space-y-1 text-amber-900 dark:text-amber-100">
          <p className="font-medium">
            v2.0.1 — correção da leitura DS18B20 enviada ao painel
          </p>
          <p className="text-xs leading-relaxed text-amber-900/90 dark:text-amber-100/90">
            Use <code>bancada_esp32_v2_0_1.ino.bin</code>. A bancada só estará
            atualizada quando o card reportar firmware <strong>2.0.1</strong> após reiniciar.
          </p>
        </div>
      </div>



      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" /> Enviar firmware
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".bin,application/octet-stream"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
            }}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground hover:file:bg-primary/90"
          />
          <p className="text-xs text-muted-foreground">
            Compile o sketch <code>bancada_esp32_v2_0_1.ino</code> em{" "}
            <em>Sketch → Export Compiled Binary</em> e envie o{" "}
            <code>.bin</code> gerado.
          </p>


        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCode2 className="h-5 w-5" /> Firmwares disponíveis
          </CardTitle>
        </CardHeader>
        <CardContent>
          {firmwares.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum firmware enviado ainda.
            </p>
          ) : (
            <ul className="divide-y">
              {firmwares.map((f) => (
                <li
                  key={f.name}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 truncate font-mono text-sm">
                      <span className="truncate">{f.name}</span>
                      {f.name === firmwareMaisNovo()?.name && (
                        <Badge variant="default" className="shrink-0 text-[10px]">
                          mais novo
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {bytesLegivel(f.size)}
                      {f.updated_at &&
                        ` · ${new Date(f.updated_at).toLocaleString("pt-BR")}`}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(f.name)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" /> Disparar OTA
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Firmware selecionado
              </label>
              <Select
                value={selecionado}
                onValueChange={setSelecionado}
                disabled={firmwares.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione…" />
                </SelectTrigger>
                <SelectContent>
                  {firmwares.map((f) => (
                    <SelectItem key={f.name} value={f.name}>
                      {f.name}{f.name === firmwareMaisNovo()?.name ? " — mais novo" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleOtaAll}
              disabled={!selecionado || dispatchingAll || bancadas.length === 0}
            >
              {dispatchingAll ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="mr-2 h-4 w-4" />
              )}
              Atualizar todas ({bancadas.length})
            </Button>
          </div>

          <div className="rounded-md border">
            <div className="grid grid-cols-[1fr_120px_120px_140px] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
              <span>Bancada</span>
              <span>Firmware</span>
              <span>Status</span>
              <span className="text-right">Ação</span>
            </div>
            {bancadas.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                Nenhuma bancada cadastrada.
              </div>
            ) : (
              bancadas.map((b) => {
                const esperada = aguardando[b.id];
                const idadeSync = b.ultima_sync
                  ? (Date.now() - new Date(b.ultima_sync).getTime()) / 1000
                  : Infinity;
                const efetivoOffline = idadeSync > 90;
                const statusMostrado = efetivoOffline ? "Offline" : b.status;
                return (
                <div
                  key={b.id}
                  className="grid grid-cols-[1fr_120px_120px_140px] items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Cpu className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{b.nome}</span>
                  </div>
                  <span className="font-mono text-xs flex items-center gap-1">
                    {b.firmware_version ?? "—"}
                    {esperada && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        →v{esperada}
                      </span>
                    )}
                  </span>
                  <Badge
                    variant={statusMostrado === "Offline" ? "secondary" : "default"}
                    className="w-fit"
                  >
                    {statusMostrado}
                  </Badge>
                  <div className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!selecionado || dispatchingId === b.id}
                      onClick={() => handleOtaOne(b.id)}
                    >
                      {dispatchingId === b.id ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Rocket className="mr-1 h-3 w-3" />
                      )}
                      Atualizar
                    </Button>
                  </div>
                </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
