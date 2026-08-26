import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  diagnosticoArCondicionado,
  type DiagnosticoAr,
} from "@/lib/ar-condicionado.functions";

function fmt(d: string) {
  return new Date(d).toLocaleString("pt-BR");
}

export function ArDiagnostico({ arId }: { arId: string }) {
  const diagnosticar = useServerFn(diagnosticoArCondicionado);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DiagnosticoAr | null>(null);

  const carregar = async () => {
    setLoading(true);
    try {
      setData(await diagnosticar({ data: { id: arId } }));
    } finally {
      setLoading(false);
    }
  };

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !data) await carregar();
  };

  const delta =
    data?.temp_no_comando != null && data?.temp_atual != null
      ? data.temp_atual - data.temp_no_comando
      : null;

  return (
    <div className="col-span-2 border-t pt-2 sm:col-span-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={toggle}>
          {open ? (
            <ChevronUp className="mr-1 h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="mr-1 h-3.5 w-3.5" />
          )}
          Verificação e decisões da automação
        </Button>
        {open && (
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={loading}
            onClick={carregar}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Atualizar
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-2 grid gap-3 text-xs">
          {loading && !data && (
            <span className="text-muted-foreground">Carregando…</span>
          )}

          {data && (
            <>
              <div className="rounded-md border p-2">
                <div className="font-semibold">Último comando IR</div>
                {data.ultimo_comando ? (
                  <div className="mt-1 grid gap-0.5 text-muted-foreground">
                    <span>
                      {data.ultimo_comando.acao === "on" ? "LIGAR" : "DESLIGAR"}
                      {data.ultimo_comando.modo
                        ? ` (${data.ultimo_comando.modo})`
                        : ""}{" "}
                      · criado {fmt(data.ultimo_comando.created_at)}
                    </span>
                    <span>
                      Entrega na prateleira:{" "}
                      {data.ultimo_comando.entregue_em ? (
                        <span className="text-emerald-600">
                          confirmada {fmt(data.ultimo_comando.entregue_em)}
                        </span>
                      ) : (
                        <span className="text-red-600">
                          pendente (a prateleira ainda não buscou o comando)
                        </span>
                      )}
                    </span>
                    <span>
                      Temperatura no comando:{" "}
                      {data.temp_no_comando != null
                        ? `${data.temp_no_comando.toFixed(1)}°C`
                        : "—"}{" "}
                      · agora:{" "}
                      {data.temp_atual != null
                        ? `${data.temp_atual.toFixed(1)}°C`
                        : "—"}
                      {delta != null && (
                        <>
                          {" "}
                          ({delta > 0 ? "+" : ""}
                          {delta.toFixed(1)}°C)
                        </>
                      )}
                    </span>
                    {delta != null &&
                      data.ultimo_comando.acao === "on" &&
                      data.ultimo_comando.modo !== "heat" &&
                      delta > 0.3 && (
                        <span className="text-amber-600">
                          O ar foi ligado no frio mas a temperatura subiu — pode
                          ser código IR não recebido pelo aparelho. Use “Frio ON”
                          apontando o emissor e reaprenda o IR se necessário.
                        </span>
                      )}
                  </div>
                ) : (
                  <div className="mt-1 text-muted-foreground">
                    Nenhum comando enviado ainda.
                  </div>
                )}
              </div>

              <div className="rounded-md border p-2">
                <div className="font-semibold">
                  Decisões da automação (mais recentes)
                </div>
                {data.decisoes.length === 0 ? (
                  <div className="mt-1 text-muted-foreground">
                    Sem registros ainda — a automação grava a cada verificação.
                  </div>
                ) : (
                  <div className="mt-1 overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="pr-3 font-normal">Quando</th>
                          <th className="pr-3 font-normal">Temp / origem</th>
                          <th className="pr-3 font-normal">Faixa</th>
                          <th className="pr-3 font-normal">Estado → decisão</th>
                          <th className="pr-3 font-normal">Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.decisoes.map((d) => (
                          <tr key={d.id} className="border-t">
                            <td className="py-1 pr-3 whitespace-nowrap">
                              {fmt(d.criado_em)}
                            </td>
                            <td className="py-1 pr-3 whitespace-nowrap">
                              {d.temperatura_ref != null
                                ? `${Number(d.temperatura_ref).toFixed(1)}°C`
                                : "—"}
                              <span className="text-muted-foreground">
                                {d.origem ? ` · ${d.origem}` : ""}
                              </span>
                            </td>
                            <td className="py-1 pr-3 whitespace-nowrap">
                              {d.temp_min != null && d.temp_max != null
                                ? `${d.temp_min}–${d.temp_max}°C`
                                : "—"}
                            </td>
                            <td className="py-1 pr-3 whitespace-nowrap">
                              {d.estado_atual ?? "—"} → {d.decisao ?? "—"}
                              {d.comando_enviado && (
                                <span className="ml-1 text-emerald-600">
                                  (comando)
                                </span>
                              )}
                            </td>
                            <td className="py-1 pr-3 text-muted-foreground">
                              {d.motivo}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
