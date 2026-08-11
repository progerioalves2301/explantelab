Plano de ação

Objetivo: retirar da interface de Atualização OTA a explicação sobre downgrade de firmware, deixando a tela sem texto explicativo sobre o assunto.

Mudança prevista
- Remover o parágrafo residual (`<p className="text-xs text-muted-foreground mt-2">`) em `src/routes/_shell.atualizacao.tsx` (linhas 371–373), que foi deixado com apenas um caractere de nova linha após a remoção anterior do texto de downgrade.

Escopo
- Apenas a página de atualização OTA.
- Nenhuma alteração de backend, firmware ou regras de negócio.
