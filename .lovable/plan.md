# Independência sem migrar: seu app, seu domínio, mesmos ESPs

Nada de firmware, nada de janela de manutenção, nenhuma prateleira sai do ar. Os ESP32 continuam gravando exatamente onde gravam hoje. O que muda é o **app**: ele passa a rodar no seu Vercel, no seu domínio, com credenciais que você tem em mãos, e as três abas administrativas passam a funcionar sem depender de chave secreta.

## O que já é seu hoje

A URL do backend e a chave publicável (anon) **você já tem** — estão nas variáveis do projeto e podem ser colocadas no Vercel. Com essas duas, todo o app funciona: prateleiras, ciclos, temperatura, ar-condicionado, relatórios, gráficos, alertas. O único ponto que hoje depende de chave secreta é o gerenciamento de usuários.

## O plano

1. **Eliminar a dependência de chave secreta no gerenciamento de usuários**

   Reescrever as três operações para não precisarem de `service_role`:
   - **Redefinir senha** → passa a usar o envio de e-mail de redefinição pelo próprio serviço de autenticação (funciona só com a chave publicável).
   - **Criar usuário** → convite por e-mail: o admin cadastra o e-mail e o papel; o usuário define a senha ao aceitar. O papel já fica pré-atribuído.
   - **Remover usuário** → uma função no banco, executada com privilégio próprio e liberada apenas para quem é administrador, que apaga o usuário e seus papéis. Nenhuma chave secreta envolvida.

   Resultado: a aba **Usuários** funciona no seu Vercel apenas com a chave publicável.

2. **Abas "Dados e exportação" e "Atualização"**
   - **Dados e exportação** passa a gerar os arquivos direto do banco com a sessão do próprio administrador (RLS já permite), sem chave secreta.
   - **Atualização (OTA)** passa a usar link assinado gerado por função do banco, também sem chave secreta.

3. **Deploy no seu Vercel**
   - Configurar as variáveis (URL + chave publicável) e o seu domínio.
   - A partir daí o app é seu: você publica, versiona e opera sem depender deste editor.

4. **Seus dados na sua mão, continuamente**
   - Rotina de backup: exportação periódica das tabelas operacionais (leituras de temperatura, pesos, CO2, histórico de status, auditoria) em CSV, para você guardar onde quiser.
   - Assim, mesmo sem migrar agora, você deixa de ficar dependente de um único lugar para não perder histórico.

5. **Deixar a migração futura pronta, sem executá-la**
   - O `schema_completo.sql` já rodou no seu Supabase, então o destino existe.
   - Preparar a **v2.5.4** do firmware com backend configurável (URL e chave gravadas na memória, editáveis pelo portal VitroCeres) e deixá-la pronta no repositório, **sem enviar OTA**. No dia que fizer sentido — troca de equipamento, manutenção programada, prateleira nova — a virada é só configuração, não recompilação.

## Ordem

Passos 1 a 3 podem ser feitos agora e não tocam em nenhum ESP32. O passo 4 é aditivo. O passo 5 fica na gaveta, pronto, para quando você e o cliente decidirem.

## Detalhes técnicos

- `src/routes/_shell.usuarios.tsx`: remover os contornos client-side atuais; usar `supabase.auth.resetPasswordForEmail` e `supabase.auth.signInWithOtp`/fluxo de convite para criação, e RPC `admin_remover_usuario` (SECURITY DEFINER, guardada por `has_role(auth.uid(),'admin')`) para exclusão.
- Migração nova: função `admin_remover_usuario(uuid)` apagando de `auth.users` e `public.user_roles`, com GRANT EXECUTE para `authenticated` e checagem de papel dentro da função.
- `src/routes/_shell.atualizacao.tsx`: link assinado do bucket `firmware` via RPC em vez de cliente admin.
- Vercel: apenas `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`; nenhuma variável secreta necessária.
- Firmware v2.5.4: `SUPABASE_URL`/`SUPABASE_ANON_KEY` saem dos `#define` para `Preferences`, com campos extras no WiFiManager e fallback para os valores atuais quando a memória estiver vazia. Fica pronto no repositório, sem publicar OTA.
