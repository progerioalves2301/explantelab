# Atualização do firmware ESP32 para o novo Supabase

Após rodar `supabase/schema_completo.sql` no seu projeto Supabase, os ESP32 precisam ser reapontados para o novo backend. O firmware atual (v2.5.3) está hardcoded com a URL e a chave do Lovable Cloud.

## O que será feito

1. Criar firmware **v2.5.4** com as credenciais do novo Supabase parametrizáveis por `#define` ou constantes editáveis no topo do arquivo.
2. Atualizar `MIGRACAO_SUPABASE.md` com as instruções exatas de recompilação e OTA.
3. Garantir que os endpoints públicos do Vercel (`/api/public/co2/reading`, `/api/public/scale/reading`, `/api/public/bench/*`) continuem sendo usados para balanças/CO2, enquanto as RPCs do Supabase continuam para telemetria/comandos/ar-condicionado.

## Detalhes técnicos

- O arquivo a editar é `firmware/bancada_esp32_v2_5_3/bancada_esp32_v2_5_3.ino`.
- As linhas 64-69 contêm `SUPABASE_URL` e `SUPABASE_ANON_KEY` fixos do projeto atual (`ftfboqlapblxndizyaxy`).
- A linha 22 contém `API_HOST = "https://explantelab.lovable.app"`, usado para balança/CO2 e OTA.
- Será criada uma nova pasta `firmware/bancada_esp32_v2_5_4/` com o `.ino` renomeado e os valores trocados por placeholders `SEU_SUPABASE_URL`, `SEU_SUPABASE_ANON_KEY` e `SEU_DOMINIO_VERCEL`.
- O certificado ISRG Root X1 usado para pinning permanece o mesmo, pois o novo backend também é Supabase.
- Se a tabela `bancada_secrets` for migrada (copiada), os ESP32 já reconhecem os tokens e não precisam ser pareados novamente. Caso contrário, cada prateleira terá que passar pelo pareamento de 6 dígitos.

## Entregáveis

- `firmware/bancada_esp32_v2_5_4/bancada_esp32_v2_5_4.ino` com placeholders documentados.
- Seção atualizada em `MIGRACAO_SUPABASE.md` explicando como preencher os três valores e como subir via OTA ou cabo.
- Atualização do `mem://index.md` para refletir a versão atual do firmware.

## Não incluído neste plano

- Não serão alteradas as funcionalidades do firmware (ciclos, luz, ar-condicionado, balança, CO2, botão físico).
- Não serão alteradas as rotas do app web; elas já funcionam com qualquer Supabase desde que as variáveis de ambiente estejam corretas.
