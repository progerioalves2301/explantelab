// Utilidades de agendamento — fuso America/Sao_Paulo.

const TZ = "America/Sao_Paulo";

/** Retorna HH:MM atuais no fuso de São Paulo. */
function agoraSP(): { h: number; m: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { h: get("hour"), m: get("minute"), s: get("second") };
}

/**
 * Segundos até o próximo horário (HH:MM) da lista. Se a lista está vazia,
 * retorna null.
 */
export function proximoDisparoSegundos(
  horarios: string[] | undefined | null,
): number | null {
  if (!horarios || horarios.length === 0) return null;
  const { h, m, s } = agoraSP();
  const agora = h * 3600 + m * 60 + s;
  const alvos = horarios
    .map((t) => {
      const [hh, mm] = t.split(":").map(Number);
      if (isNaN(hh) || isNaN(mm)) return null;
      return hh * 3600 + mm * 60;
    })
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  if (alvos.length === 0) return null;
  for (const a of alvos) if (a > agora) return a - agora;
  // Próximo é amanhã (primeiro horário + 24h restantes).
  return 86400 - agora + alvos[0];
}
