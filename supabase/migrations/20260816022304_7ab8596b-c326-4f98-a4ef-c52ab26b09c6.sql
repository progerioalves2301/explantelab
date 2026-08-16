-- Tabela para registrar quando a luz foi ligada/desligada
CREATE TABLE public.luz_status_log (
    id bigserial PRIMARY KEY,
    bancada_id uuid REFERENCES public.bancadas(id) ON DELETE CASCADE NOT NULL,
    ligada boolean NOT NULL,
    changed_at timestamptz DEFAULT now() NOT NULL
);

-- Permissões
GRANT SELECT ON public.luz_status_log TO authenticated;
GRANT ALL ON public.luz_status_log TO service_role;

-- RLS
ALTER TABLE public.luz_status_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários autenticados podem ver logs de luz"
ON public.luz_status_log FOR SELECT
TO authenticated
USING (true);

-- Índices para performance no gráfico
CREATE INDEX idx_luz_status_log_bancada_time ON public.luz_status_log (bancada_id, changed_at);

-- Função para listar o histórico de luz como intervalos
CREATE OR REPLACE FUNCTION public.listar_historico_luz(_bancada_id uuid, _desde timestamptz)
RETURNS TABLE (
    ligada boolean,
    inicio timestamptz,
    fim timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    estado_inicial boolean;
BEGIN
    -- Descobre o estado da luz imediatamente ANTES do período solicitado
    SELECT l.ligada INTO estado_inicial
    FROM public.luz_status_log l
    WHERE l.bancada_id = _bancada_id
      AND l.changed_at < _desde
    ORDER BY l.changed_at DESC
    LIMIT 1;

    -- Se não houver log anterior, assume desligado
    IF estado_inicial IS NULL THEN
        estado_inicial := false;
      END IF;

    RETURN QUERY
    WITH logs AS (
        -- Primeiro ponto artificial para o início do período
        SELECT estado_inicial as ligada, _desde as ts
        UNION ALL
        SELECT l.ligada, l.changed_at
        FROM public.luz_status_log l
        WHERE l.bancada_id = _bancada_id
          AND l.changed_at >= _desde
        ORDER BY ts ASC
    ),
    intervals AS (
        SELECT
            l.ligada,
            l.ts as inicio,
            LEAD(l.ts, 1, now()) OVER (ORDER BY l.ts) as fim
        FROM logs l
    )
    SELECT i.ligada, i.inicio, i.fim
    FROM intervals i
    WHERE i.ligada = true -- Só interessa quando a luz estava acesa
      AND i.inicio < i.fim;
END;
$$;

GRANT EXECUTE ON FUNCTION public.listar_historico_luz(uuid, timestamptz) TO authenticated;

-- Trigger para automatizar a gravação no log quando o estado da luz mudar na tabela bancadas
CREATE OR REPLACE FUNCTION public.trg_log_luz_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF (TG_OP = 'INSERT') OR (OLD.luz_ligada IS DISTINCT FROM NEW.luz_ligada) THEN
        INSERT INTO public.luz_status_log (bancada_id, ligada, changed_at)
        VALUES (NEW.id, NEW.luz_ligada, now());
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bancadas_luz_log
AFTER UPDATE OF luz_ligada OR INSERT ON public.bancadas
FOR EACH ROW
EXECUTE FUNCTION public.trg_log_luz_change();
