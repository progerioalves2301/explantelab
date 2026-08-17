# Area de Testes para Administrador

Criar uma área restrita para o administrador (`admin@admin.com.br`) testar novos equipamentos (balanças, sensores CO2, prateleiras) de forma isolada do restante do sistema.

## Alteracoes

### Banco de Dados
- Criar coluna `is_teste` (boolean, default false) na tabela `public.bancadas`.
- Atualizar as RLS Policies da tabela `bancadas` para que prateleiras com `is_teste = true` sejam visíveis apenas por administradores.
- Ajustar `GRANT` e permissões para a nova coluna.

### Frontend
- **Nova Rota**: Criar `src/routes/_shell.area-testes.tsx` para listar e gerenciar apenas equipamentos marcados como teste.
- **Sidebar**: Adicionar o link "Área de Testes" no `src/components/app-sidebar.tsx`, visível apenas para administradores.
- **Dashboard**: Filtrar a listagem principal para NÃO exibir equipamentos marcados como teste por padrão.
- **Configuracao**: Adicionar a opção "Equipamento de Teste" em `src/components/bancada-config-dialog.tsx`.

## Detalhes Tecnicos
- SQL Migration para adicionar `is_teste` e atualizar policies:
  ```sql
  ALTER TABLE public.bancadas ADD COLUMN is_teste boolean NOT NULL DEFAULT false;
  DROP POLICY IF EXISTS "public read bancadas" ON public.bancadas;
  CREATE POLICY "read non-test benches" ON public.bancadas FOR SELECT TO authenticated USING (is_teste = false);
  CREATE POLICY "admin read all benches" ON public.bancadas FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  -- Adicionar policies similares para INSERT/UPDATE/DELETE se necessário
  ```
- O componente `BancadaCard` receberá um tratamento visual (badge ou borda diferenciada) para itens de teste.

## Verificacao
- Login como administrador: deve ver a nova aba e prateleiras de teste.
- Login como operador/visualizador: não deve ver a aba nem os equipamentos de teste.
