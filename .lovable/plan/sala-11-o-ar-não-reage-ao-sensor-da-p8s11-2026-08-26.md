# Sala 11: o ar não reage ao sensor da P8S11

## O que os dados mostram

Verifiquei o banco agora:

- O ar da sala 11 (AUFIT) está com **agregação = "máxima"**, e a decisão automática usa a **maior temperatura entre TODAS as prateleiras da sala 11**, não a da prateleira controladora.
- Últimas leituras da sala 11: P1S11 23,8 °C, P3S11 23,9 °C, P4S11 23,5 °C, P5S11 23,6 °C, P6S11 24,2 °C — e **P8S11 20,9 °C**.
- A temperatura de referência gravada no ar é **24,4 °C** (não 20,9 °C da P8S11).
- Faixa configurada na P8S11: 19–22 °C, histerese 1,0.

Ou seja: com 24,4 °C de referência, a lógica quer o ar **sempre ligado em cool** (só desligaria abaixo de 21 °C na maior prateleira). Aquecer ou esfriar o sensor da P8S11 não muda nada, porque quem manda é o pico da sala.

Também confirmei que os comandos IR estão saindo (ON às 16:52, OFF às 16:20, entregues em segundos), então token/IR/entrega estão funcionando — o problema é **qual temperatura é usada** e o intervalo mínimo entre comandos (hoje forçado a no mínimo 5 minutos, então a reação nunca é imediata).

## O que fazer

1. Adicionar a opção de agregação **"somente a prateleira controladora"** no ar-condicionado, e deixá-la como escolha na tela de Ar-condicionado (Média / Máxima / Somente controladora).
2. Configurar o ar da sala 11 para usar essa opção — assim a temperatura da P8S11 passa a ser a referência real, e aquecer/esfriar o sensor liga/desliga o ar.
3. Mostrar na tela de Ar-condicionado, de forma explícita: "Temperatura de referência: X °C (origem: prateleira P8S11 / máxima da sala / média da sala)" e a próxima janela em que um comando pode ser enviado. Hoje isso é invisível, o que faz parecer que nada acontece.
4. Reduzir o piso do intervalo mínimo entre comandos de 300 s para o valor configurado (mínimo 60 s), para que o teste com o sensor na mão responda em ~1 minuto em vez de 5.
5. Adicionar um botão **"Ressincronizar estado"** que força o reenvio do último estado desejado (útil quando o banco acha que está ligado mas o aparelho está desligado, por exemplo depois de testes manuais).

## Detalhes técnicos

- Migração: `ALTER TYPE`/check da coluna `ar_condicionados.agregacao` para aceitar `'controladora'`; alterar `public.decidir_ar_condicionado()` para, nesse modo, ler `temperatura_planta` apenas da `bancada_controladora_id` (mantendo o filtro de `sensor_travado` e `ultima_sync` recente); trocar `GREATEST(intervalo_min_comando_s, 300)` por `GREATEST(intervalo_min_comando_s, 60)`.
- `src/lib/ar-condicionado.functions.ts`: incluir `'controladora'` no enum Zod e no tipo `ArCondicionado`; nova server fn `ressincronizarArCondicionado` (reenvia AC_CONTROL com o estado atual, limpando comandos AC pendentes).
- `src/routes/_shell.ar-condicionado.tsx`: opção nova no seletor de agregação, bloco de diagnóstico (referência, origem, `ultimo_temp_lida`, `ultimo_comando_em`, próxima janela) e botão "Ressincronizar estado".
- Sem mudança de firmware: a prateleira continua só executando `AC_CONTROL` com o código IR RAW aprendido.
- Documentar em `CHANGELOG.md`.
