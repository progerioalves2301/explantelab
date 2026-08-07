# Plano: Manter ESP32s conectados durante migração para Vercel/Supabase próprio

## Resumo da situação
Sim. Os ESP32 já em campo estão gravados com o **URL e anon key do Lovable Cloud** (`ftfboqlapblxndizyaxy.supabase.co`). Se você apontar o app para um novo Supabase sem atualizar os dispositivos, eles continuam enviando telemetria para o banco antigo, mas o app no Vercel não lê mais de lá — parece que "pararam de transmitir" na nova interface.

A solução é dar aos ESP32 a capacidade de usar um backend configurável, migrando-os via OTA para o novo Supabase. Enquanto isso não acontece, o app no Vercel pode sincronizar/replicar os dados do banco antigo como ponte temporária.

## Estratégia escolhida (fallback para quem ainda não migrou)

1. **Firmware v2.5.4 — backend configurável**
   - Criar `firmware/bancada_esp32_v2_5_4/bancada_esp32_v2_5_4.ino`.
   - Tornar `SUPABASE_URL` e `SUPABASE_ANON_KEY` configuráveis via WiFiManager (campos extras no portal) e salvar em `Preferences` (NVS).
   - Manter os valores atuais do Lovable Cloud como **fallback** caso nada seja configurado — assim dispositivos não atualizados continuam funcionando no banco antigo.
   - Todas as chamadas RPC (`bench_push_telemetry`, `bench_pull_commands`, `bench_pair`, etc.) passam a usar a URL/anon configuráveis.

2. **OTA para o novo backend**
   - A tela `/_shell/atualizacao` já envia OTA para prateleiras selecionadas ou todas.
   - Gerar binário `.bin` da v2.5.4 e enviar para o bucket `firmware`.
   - Disparar OTA em massa para as prateleiras. Cada ESP32 baixa o novo firmware, reinicia e passa a aceitar configuração de backend.
   - Após OTA, a prateleira deve ser re-pareada ou receber um comando via app para gravar a nova URL/anon key do Supabase do Vercel.

3. **Configuração do novo backend no dispositivo**
   - Adicionar um novo comando `SET_BACKEND` que permite o app enviar URL + anon key do Supabase novo para a prateleira.
   - O ESP32 grava em `Preferences` e passa a usar o novo backend a partir do próximo boot/ciclo.
   - Esse comando pode ser disparado automaticamente após OTA bem-sucedida ou manualmente pelo usuário.

4. **Ponte temporária (opcional, mas recomendada para não perder dados durante transição)**
   - Criar uma função simples de sincronização que copia telemetria recente do banco Lovable Cloud para o novo Supabase do Vercel.
   - Isso mantém os dados visíveis no app mesmo para prateleiras que ainda não foram atualizadas.
   - A ponte pode ser desativada assim que todos os dispositivos estiverem no novo backend.

5. **Documentação da migração**
   - Atualizar `MIGRACAO_SUPABASE.md` com o passo-a-passo:
     a. Compilar a v2.5.4 e gerar `.bin`.
     b. Fazer upload do binário na tela Atualização.
     c. Disparar OTA para todas as prateleiras.
     d. Enviar comando `SET_BACKEND` com URL/anon key do novo Supabase.
     e. Verificar se as prateleiras aparecem online no app do Vercel.
     f. (Opcional) Ligar a ponte de dados até que todos os dispositivos migrem.

## O que muda no código

### Firmware v2.5.4
- Novo arquivo `firmware/bancada_esp32_v2_5_4/bancada_esp32_v2_5_4.ino` baseado na v2.5.3.
- Adicionar campos `custom_supabase_url` e `custom_supabase_anon` no WiFiManager.
- Adicionar função `carregarBackendConfig()` que lê NVS e retorna URL/anon a serem usados.
- Adicionar handler para comando `SET_BACKEND` que grava a nova configuração em NVS.
- Atualizar a constante `FIRMWARE_VERSION` para `"2.5.4"`.

### Web app
- No arquivo `src/lib/atualizacao.functions.ts` e/ou na tela `/_shell/atualizacao`, adicionar botão para enviar comando `SET_BACKEND` para uma prateleira ou todas, com os valores do novo Supabase lidos de variáveis de ambiente.
- Criar (opcional) função server de sincronização de dados do banco Lovable para o novo Supabase, com endpoint agendado manualmente.
- Atualizar documentação de migração.

### Banco de dados
- Nenhuma alteração de schema é necessária. O comando `SET_BACKEND` é entregue pela tabela `comandos` existente, já que o payload é genérico (`tipo` + `payload`).

## Critérios de conclusão
- [ ] Firmware v2.5.4 compila sem erros e mantém todos os recursos da v2.5.3.
- [ ] WiFiManager permite digitar URL e anon key do Supabase.
- [ ] Comando `SET_BACKEND` é processado pelo ESP32 e persiste em NVS.
- [ ] Tela OTA permite enviar `SET_BACKEND` em massa.
- [ ] Documentação de migração atualizada.
- [ ] (Opcional) Ponte de sincronização funcionando entre bancos.

## Riscos e cuidados
- OTA em campo pode falhar se a conexão Wi-Fi estiver instável. Recomenda-se atualizar uma prateleira de teste primeiro.
- Se o anon key do novo Supabase estiver errado, a prateleira não conseguirá autenticar e ficará offline até ser reconfigurada (pode ser feito via WiFiManager resetando a configuração).
- Durante a transição, a ponte temporária evita perda de visibilidade, mas não deve ser mantida indefinidamente para evitar duplicidade/confusão.
