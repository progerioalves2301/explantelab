# Diagnóstico da prateleira que perde o firmware após queda de fase

## Diagnóstico atual

- `waiting for download` ao segurar **BOOT** é normal: esse botão coloca o ESP32 no modo de gravação.
- `invalid header: 0xffffffff` ao apertar somente **EN/RST** significa que o bootloader não encontrou uma imagem legível na memória flash.
- Como uma nova gravação recupera a placa, mas o problema reaparece depois de desligar e religar a fase, a principal suspeita é um transiente ou subida instável da alimentação corrompendo/impedindo a leitura da flash. Uma flash fisicamente degradada também deve ser descartada.
- Esse erro acontece antes do firmware começar a executar; portanto, uma correção somente no código não consegue recuperar a placa nesse estado.

## Plano de teste

1. **Recuperar corretamente a placa**
   - Fazer apagamento completo da flash, não apenas upload por cima.
   - Gravar novamente o firmware e confirmar que inicia ao apertar somente EN/RST.

2. **Isolar alimentação de lógica e potência**
   - Manter o ESP32 alimentado por USB ou fonte 5 V dedicada.
   - Desligar e religar a fase dos relés/solenoides várias vezes.
   - Se não corromper, fica comprovado que o defeito entra pela alimentação compartilhada ou por transiente das cargas.

3. **Testar a placa sem qualquer periférico**
   - Desconectar relés, válvulas, sensores, I²C e IR, deixando apenas USB.
   - Repetir os ciclos de energia.
   - Se ainda ocorrer, substituir temporariamente o ESP32: a flash ou o regulador da placa provavelmente está danificado.

4. **Corrigir a instalação elétrica**
   - Usar fonte dedicada e estabilizada de 5 V, com margem de corrente.
   - Não alimentar o ESP32 pela placa de relés.
   - Colocar próximo ao ESP32 capacitor eletrolítico de 470–1000 µF e cerâmico de 100 nF.
   - Separar cabos de lógica dos cabos de fase, válvulas e cargas indutivas.
   - Aplicar proteção adequada nas cargas/entrada: snubber RC, MOV e aterramento conforme a instalação.
   - Verificar se nenhum periférico força pinos de configuração de boot, especialmente GPIO0, GPIO2, GPIO12 e GPIO15, durante a energização.

5. **Validar a causa**
   - Executar pelo menos 10 ciclos de desligamento/retorno da fase com o ESP32 isolado e depois com os periféricos reconectados em etapas.
   - Registrar em qual etapa o `invalid header` reaparece.

## Decisão após os testes

- **Falha apenas com a fonte/cargas conectadas:** corrigir alimentação, proteção e roteamento dos cabos.
- **Falha até isolado por USB:** substituir a placa ESP32, pois a flash/regulador provavelmente sofreu dano.
- **Falha ao conectar um periférico específico:** revisar alimentação, aterramento e pinos desse módulo.

Nenhuma alteração no aplicativo ou no firmware será feita nesta etapa; primeiro será isolada a causa elétrica/hardware.
