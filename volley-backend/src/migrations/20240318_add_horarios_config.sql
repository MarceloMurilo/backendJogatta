-- Adiciona coluna horarios_config na tabela quadras
ALTER TABLE quadras
ADD COLUMN horarios_config JSONB DEFAULT '{}'::jsonb;

-- Atualiza quadras existentes com configuração padrão (todos os horários disponíveis)
UPDATE quadras
SET horarios_config = jsonb_build_object(
  '0', jsonb_object_agg(h.hora, true),
  '1', jsonb_object_agg(h.hora, true),
  '2', jsonb_object_agg(h.hora, true),
  '3', jsonb_object_agg(h.hora, true),
  '4', jsonb_object_agg(h.hora, true),
  '5', jsonb_object_agg(h.hora, true),
  '6', jsonb_object_agg(h.hora, true)
)
FROM (
  SELECT to_char(hora, 'HH24:00') as hora
  FROM generate_series(
    '2024-01-01 06:00:00'::timestamp,
    '2024-01-01 22:00:00'::timestamp,
    '1 hour'
  ) as hora
) h; 