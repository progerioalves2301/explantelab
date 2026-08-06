# Acessórios por prateleira (perfil de hardware)

Faz sentido, sim — e não gera conflito, desde que os campos sejam **declarativos** (o que a prateleira tem) e a lógica atual continue sendo a fonte da verdade do que está acontecendo. Hoje o sistema tenta *adivinhar* isso (ex.: "sem sensor" é inferido de `temperatura_planta == null`), o que já causou alertas falsos. Declarar explicitamente resolve isso.

## O que muda

Ao cadastrar (e depois editar) uma prateleira, marcar quais acessórios ela possui:

- Sensor de temperatura (DS18B20)
- Controle de luz (timer)
- Balança
- Sensor de CO2
- Controla ar-condicionado (IR)

Padrão para prateleiras já existentes: sensor de temperatura e luz ligados, balança/CO2/AC desligados — mantendo o comportamento atual.

## Efeitos na interface

- **Card da prateleira**: badge de luz, temperatura, extremos 30d e mini-status só aparecem se o acessório existir. Sem sensor → nada de "sensor travado"/alerta vermelho, apenas ausência do bloco.
- **Configurações da prateleira**: limites de alerta de temperatura só se tiver sensor (hoje isso já é inferido — passa a usar a flag); janelas de luz só se tiver controle de luz.
- **Ar-condicionado**: o seletor de prateleira controladora lista apenas prateleiras marcadas como "controla AC" e com sensor de temperatura (é de lá que vem a temperatura de referência).
- **Balança / CO2**: na associação de balança e sensor de CO2, filtrar prateleiras compatíveis.
- **Relatórios de temperatura e alertas**: ignoram prateleiras sem sensor (hoje aparecem como linhas vazias).

## Efeitos no firmware / backend

- A detecção de alertas de temperatura passa a pular prateleiras sem sensor declarado (evita alerta de "sem leitura").
- O firmware continua igual na v2.5.3: as flags são metadados de UI/alertas. Opcionalmente, num passo seguinte, elas podem viajar no `UPDATE_CONFIG` para o ESP32 desabilitar a leitura do DS18B20 e o pino de luz — mas isso não é necessário agora e fica fora deste escopo.

## Possíveis conflitos (e como tratamos)

- Prateleira marcada "sem sensor" mas que envia temperatura: a leitura ainda é gravada; a UI mostra um aviso discreto sugerindo marcar o acessório, sem quebrar nada.
- Prateleira marcada "sem luz" com janelas de luz salvas: as janelas ficam preservadas no banco, só somem da UI.
- AC apontando para prateleira que depois é desmarcada: o vínculo é mantido e a tela de AC mostra aviso de configuração inconsistente.

## Detalhes técnicos

- Migração: colunas booleanas em `public.bancadas` — `tem_sensor_temp` (default true), `tem_luz` (default true), `tem_balanca` (default false), `tem_co2` (default false), `controla_ar` (default false); mais um backfill para prateleiras existentes com `temperatura_planta IS NULL AND sensor_reinicios = 0` → `tem_sensor_temp = false`.
- `src/lib/types.ts`: campos novos em `Bancada`.
- `src/lib/bancadas.functions.ts`: `criarBancada` e `atualizarBancada` aceitam as flags (validação Zod).
- `src/routes/_shell.bancadas.nova.tsx`: bloco "Acessórios" com switches.
- `src/components/bancada-config-dialog.tsx`: mesmos switches + troca do `semSensor` inferido pela flag.
- `src/components/bancada-card.tsx`, `_shell.ar-condicionado.tsx`, `_shell.co2.tsx`, `_shell.relatorios-temperatura.tsx`: renderização/filtros condicionais.
- Função `detectar_alertas()`: filtro por `tem_sensor_temp`.
