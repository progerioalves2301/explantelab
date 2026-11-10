// Envio direto pela API oficial do Telegram (sem intermediário do Lovable).
// Configure a variável de servidor TELEGRAM_BOT_TOKEN com o token do seu bot
// (o que o @BotFather entrega, no formato 123456789:AA...).

export function telegramConfigurado(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

export async function enviarTelegram(chatId: string, text: string): Promise<Response> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram não configurado: defina TELEGRAM_BOT_TOKEN");
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}
