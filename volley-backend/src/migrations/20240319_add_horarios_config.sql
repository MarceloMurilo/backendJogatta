-- Adiciona a coluna horarios_config como JSONB
ALTER TABLE quadras ADD COLUMN IF NOT EXISTS horarios_config JSONB DEFAULT '{}'::jsonb;

-- Atualiza as quadras existentes com uma configuração padrão
WITH dias_semana AS (
  SELECT generate_series(0, 6) as dia
),
horarios AS (
  SELECT generate_series(6, 22) as hora
),
config_padrao AS (
  SELECT 
    dia,
    jsonb_object_agg(
      hora::text || ':00',
      true
    ) as horarios_dia
  FROM dias_semana, horarios
  GROUP BY dia
)
UPDATE quadras
SET horarios_config = (
  SELECT jsonb_object_agg(
    dia::text,
    horarios_dia
  )
  FROM config_padrao
)
WHERE horarios_config IS NULL OR horarios_config = '{}'::jsonb; 