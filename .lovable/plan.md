# Area de Testes para Administrador

Criar uma área restrita para o administrador (`admin@admin.com.br`) testar novos equipamentos (balanças, sensores CO2, prateleiras) de forma isolada do restante do sistema.

## Alteracoes

### Banco de Dados
- Criar coluna `is_teste` (boolean, default false) na tabela `public.bancadas`.
- Atualizar as RLS Policies da tabela `bancadas` para que prateleiras com `is_teste = true` sejam visíveis apenas por administradores.
- Atualizar a função `detectar_alertas` (se existir) para ignorar equipamentos em teste ou tratá-los separadamente.

### Frontend
- **Nova Rota**: Criar `src/routes/_shell.area-testes.tsx` para listar e gerenciar apenas equipamentos marcados como teste.
- **Sidebar**: Adicionar o link "Área de Testes" no `src/components/app-sidebar.tsx`, visível apenas para administradores.
- **Dashboard**: Filtrar a listagem principal para NÃO exibir equipamentos marcados como teste (a menos que o usuário seja admin e escolha vê-los, ou mantê-los estritamente na nova aba).
- **Formulário de Cadastro**: Adicionar a opção "Equipamento de Teste" ao criar/editar uma prateleira.

## Detalhes Tecnicos
- A filtragem será feita via RLS no banco de dados para garantir segurança máxima:
  ```sql
  -- Policy existente de leitura pública será restrita:
  DROP POLICY "public read bancadas" ON public.bancadas;
  CREATE POLICY "read non-test benches" ON public.bancadas
    FOR SELECT TO authenticated
    USING (is_teste = false);
  CREATE POLICY "admin read all benches" ON public.bancadas
    FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));
  ```
- No frontend, o componente `BancadaCard` poderá ter um badge visual indicando "MODO TESTE".

## Verificacao
- Acessar com conta não-admin e verificar que prateleiras de teste não aparecem no Dashboard nem na Sidebar.
- Acessar como `admin@admin.com.br` e verificar o acesso à nova área e a visibilidade dos equipamentos.
