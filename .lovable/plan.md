# Liberar memória antes do OTA (firmware v2.5.9)

## Minha avaliação da sugestão do Gemini

A sugestão está correta e vale aplicar. Confirmei no código atual (v2.5.8):

- Existe um cliente TLS global persistente (`WiFiClientSecure httpsClient` + `HTTPClient http`) usado na telemetria.
- No comando `OTA_UPDATE`, o código chama `enviarTelemetria()` e, em seguida, cria um segundo cliente TLS (`WiFiClientSecure otaClient`) sem fechar o primeiro.
- `http.end()` é chamado ao fim de cada requisição, mas a conexão TCP/SSL global continua aberta (keep-alive), então o buffer de criptografia (~30–40 KB) permanece alocado.

Ou seja: no instante do OTA há dois contextos TLS vivos ao mesmo tempo. Em um ESP32 rodando há dias, com heap fragmentado, isso é exatamente o tipo de pico que faz o download falhar ou o dispositivo reiniciar. A parte de segurança física (desligar válvulas e luz antes de atualizar) já está feita e continua igual.

Uma ressalva: isso melhora a confiabilidade do OTA, mas não explica a queda da P8S12 no teste de luz — aquele caso segue apontando para alimentação/relé.

## O que fazer

Nova versão de firmware `firmware/bancada_esp32_v2_5_9/` (cópia do v2_5_8 com `FIRMWARE_VERSION` = 2.5.9), com as mudanças no bloco `OTA_UPDATE`:

1. Após o último `enviarTelemetria()`, encerrar a conexão global antes de criar o cliente do OTA: `http.end()`, `httpsClient.stop()`, pequeno `delay(200)`.
2. Logar o heap livre antes e depois da limpeza (`ESP.getFreeHeap()`) e também no `onProgress`, para termos evidência real de memória em cada tentativa.
3. Se o heap livre ficar abaixo de um mínimo seguro (~45 KB), abortar o OTA com log claro em vez de tentar e travar — o comando pode ser reenviado depois.
4. Em caso de falha, além de liberar `pausado_manual`, registrar o motivo no log serial como já é feito.

## Desgaste da NVS (também procede)

Confirmei no código: `tickCarimboHoraRtc()` grava `rtc_ts` na NVS a cada 300 s (5 min), e o valor é sempre diferente (é o epoch atual), então há gravação física real toda vez — cerca de 105 mil gravações por ano. A crítica do Gemini está certa.

Mudanças no v2.5.9:

1. Intervalo do carimbo de 5 min para 1 hora (`3600UL * 1000UL`). O diagnóstico da bateria CR2032 continua funcionando: se o relógio retroceder após uma queda de luz, a comparação com o carimbo ainda detecta — a janela de incerteza passa de 5 min para 1 h, irrelevante para esse fim.
2. Gravar o carimbo também imediatamente antes de um reinício controlado (OTA), para que o último save point fique o mais recente possível.
3. Não gravar quando o valor arredondado não mudou, evitando escritas redundantes.


## Documentação

- `CHANGELOG.md`: entrada v2.5.9 explicando a liberação de memória antes do OTA, o log de heap e o novo intervalo do carimbo NVS.
- `docs/FIRMWARE.md`: seção do OTA descrevendo a ordem correta (desliga cargas → telemetria final → fecha TLS global → baixa) e o limite mínimo de heap.

## Detalhes técnicos

Arquivos: `firmware/bancada_esp32_v2_5_9/bancada_esp32_v2_5_9.ino` (novo), `CHANGELOG.md`, `docs/FIRMWARE.md`. Texto de compilação em `src/routes/_shell.atualizacao.tsx` atualizado para `bancada_esp32_v2_5_9.ino`.

Exige gravação por cabo ou OTA a partir do 2.5.8. Antes de confiar na próxima OTA, vale confirmar por que o binário 2.5.9 enviado anteriormente não passou a reportar 2.5.9 (provavelmente o `.bin` exportado não correspondia ao fonte).
