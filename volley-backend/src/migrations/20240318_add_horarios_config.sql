-- Adiciona coluna horarios_config na tabela quadras
ALTER TABLE quadras
ADD COLUMN horarios_config JSONB DEFAULT '{
  "0": {
    "06:00": true, "07:00": true, "08:00": true, "09:00": true, "10:00": true,
    "11:00": true, "12:00": true, "13:00": true, "14:00": true, "15:00": true,
    "16:00": true, "17:00": true, "18:00": true, "19:00": true, "20:00": true,
    "21:00": true, "22:00": true
  },
  "1": {
    "06:00": true, "07:00": true, "08:00": true, "09:00": true, "10:00": true,
    "11:00": true, "12:00": true, "13:00": true, "14:00": true, "15:00": true,
    "16:00": true, "17:00": true, "18:00": true, "19:00": true, "20:00": true,
    "21:00": true, "22:00": true
  },
  "2": {
    "06:00": true, "07:00": true, "08:00": true, "09:00": true, "10:00": true,
    "11:00": true, "12:00": true, "13:00": true, "14:00": true, "15:00": true,
    "16:00": true, "17:00": true, "18:00": true, "19:00": true, "20:00": true,
    "21:00": true, "22:00": true
  },
  "3": {
    "06:00": true, "07:00": true, "08:00": true, "09:00": true, "10:00": true,
    "11:00": true, "12:00": true, "13:00": true, "14:00": true, "15:00": true,
    "16:00": true, "17:00": true, "18:00": true, "19:00": true, "20:00": true,
    "21:00": true, "22:00": true
  },
  "4": {
    "06:00": true, "07:00": true, "08:00": true, "09:00": true, "10:00": true,
    "11:00": true, "12:00": true, "13:00": true, "14:00": true, "15:00": true,
    "16:00": true, "17:00": true, "18:00": true, "19:00": true, "20:00": true,
    "21:00": true, "22:00": true
  },
  "5": {
    "06:00": true, "07:00": true, "08:00": true, "09:00": true, "10:00": true,
    "11:00": true, "12:00": true, "13:00": true, "14:00": true, "15:00": true,
    "16:00": true, "17:00": true, "18:00": true, "19:00": true, "20:00": true,
    "21:00": true, "22:00": true
  },
  "6": {
    "06:00": true, "07:00": true, "08:00": true, "09:00": true, "10:00": true,
    "11:00": true, "12:00": true, "13:00": true, "14:00": true, "15:00": true,
    "16:00": true, "17:00": true, "18:00": true, "19:00": true, "20:00": true,
    "21:00": true, "22:00": true
  }
}'::jsonb;

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