## Bancada real com ESP32 + Wi-Fi + AP de configuração

### Arquitetura
```
ESP32 (bancada física)
  └─ Wi-Fi (modo AP no primeiro boot p/ configurar SSID+senha+device_id+token)
  └─ POST HTTPS  /api/public/bench/telemetry   (a cada 5s)   [header: X-Device-Token]
  └─ GET  HTTPS  /api/public/bench/commands    (a cada 2s)   [header: X-Device-Token]
        ↓
   TanStack server routes (públicas, autenticam via device_token na tabela)
        ↓
   Supabase (Lovable Cloud) — tabelas: bancadas, telemetria, comandos
        ↓
   Dashboard React usa Realtime (postgres_changes) e mostra estado ao vivo
```

### O que vou construir

**1. Backend (Lovable Cloud + migração SQL)**
- Habilitar Lovable Cloud.
- Tabela `bancadas`: `id uuid`, `nome`, `device_id text unique`, `device_token text unique` (gerado), `status`, `valvulas jsonb`, `ultima_sync timestamptz`, `proximo_ciclo_segundos int`, `config jsonb`, `owner_id uuid`.
- Tabela `comandos`: `id`, `bancada_id`, `tipo` (`FORCE_CYCLE` | `UPDATE_CONFIG` | `PAUSE` | `RESUME`), `payload jsonb`, `entregue_em timestamptz null`, `created_at`.
- Tabela `telemetria` (histórico opcional, últimos ciclos).
- RLS: usuários autenticados só veem/mexem nas próprias bancadas; ESP32 nunca fala com PostgREST — só via server routes públicas.
- GRANTs corretos para `authenticated` + `service_role`.

**2. Endpoints públicos para o ESP32** (`/api/public/bench/*`)
- `POST /api/public/bench/telemetry` → valida `X-Device-Token`, atualiza `bancadas` (status, valvulas, ultima_sync).
- `GET /api/public/bench/commands` → devolve comandos pendentes do device e marca `entregue_em`.
- Cliente `supabaseAdmin` (service role) carregado dentro do handler — RLS não se aplica ao ESP32.

**3. Dashboard**
- Substituir `MOCK_BANCADAS` por fetch real (server fn autenticado) + subscrição Realtime.
- Nova página `/bancadas/nova`: cria a bancada, gera `device_token`, mostra tela de provisionamento com:
  - Nome da rede AP (`BancadaSetup-XXXX`)
  - Passo-a-passo (conectar no AP → abrir `192.168.4.1` → colar `device_id`, `token` e URL do servidor)
  - Botão "copiar credenciais"
- Botão **Forçar ciclo manual** vira `INSERT INTO comandos`.
- Página **Configurações** salva `config` real na bancada (upsert) — dispara comando `UPDATE_CONFIG`.

**4. Firmware Arduino (`firmware/bancada_esp32.ino`)**
- WiFiManager (AP `BancadaSetup-<chipid>`, portal captivo) com parâmetros customizados: `device_id`, `device_token`, `server_url`.
- Salva credenciais em `Preferences` (NVS). Botão físico (GPIO0) para reset das credenciais.
- Loop de ciclo pneumático das 5 válvulas nos GPIOs (V1..V5), com estados `Repouso → Injetando(V1+V4) → Pausado → Retornando(V2+V3) → Alivio(V5) → Repouso`.
- Task 1: envia telemetria (HTTPS POST, JSON) a cada 5s.
- Task 2: faz polling de comandos e executa (`FORCE_CYCLE`, `UPDATE_CONFIG`, `PAUSE`, `RESUME`).
- README com pinagem (GPIO 25/26/27/32/33 p/ V1..V5) e libs necessárias (`WiFiManager`, `ArduinoJson`, `HTTPClient`).

**5. Correção rápida**
- `timeAgo()` está causando mismatch de hidratação (SSR renderiza um horário, cliente outro). Vou mover o cálculo para depois de montar (efeito `useEffect` + `useState`) ou usar `<ClientOnly>`.

### Detalhes técnicos que o usuário não precisa aprovar
- Endpoints ficam em `src/routes/api/public/bench.*.ts` (o prefixo `/api/public/` já ignora auth do Lovable no publicado, conforme padrão do projeto).
- URL estável do servidor pra colar no ESP32: `project--90989b19-e7c7-43b6-a4a1-5affc6bb05c8.lovable.app`.
- Token é 32 bytes aleatórios (base64url) gerado no backend na criação da bancada.
- ESP32 usa `WiFiClientSecure` com `setInsecure()` para simplificar (documento no README como trocar por CA cert em produção).

### Aviso importante
Este é um trabalho grande (schema + policies + 2 endpoints + provisionamento + realtime + firmware completo). Vou entregar tudo, mas em **uma única rodada de mudanças**. Depois você testa a compilação do `.ino` na sua Arduino IDE (com as libs indicadas) e me avisa se aparecer algo.

Posso seguir?