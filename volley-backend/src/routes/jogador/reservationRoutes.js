const express = require('express');
const router = express.Router();
const db = require('../../db');

// Criar uma nova reserva
router.post('/', async (req, res) => {
  const {
    id_quadra,
    id_usuario,
    data_reserva,
    horario_inicio,
    horario_fim,
    status = 'pendente',
    quantidade_jogadores,
    reservation_price
  } = req.body;

  try {
    const result = await db.query(
      `INSERT INTO reservas (
        id_quadra,
        id_usuario,
        data_reserva,
        horario_inicio,
        horario_fim,
        status,
        quantidade_jogadores,
        reservation_price
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        id_quadra,
        id_usuario,
        data_reserva,
        horario_inicio,
        horario_fim,
        status,
        quantidade_jogadores,
        reservation_price
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar reserva:', error);
    res.status(500).json({ error: 'Erro ao criar reserva' });
  }
});

// Buscar reservas por quadra
router.get('/quadra/:id_quadra', async (req, res) => {
  const { id_quadra } = req.params;

  try {
    const result = await db.query(
      `SELECT r.*, u.nome as nome_usuario
       FROM reservas r
       JOIN usuario u ON r.id_usuario = u.id_usuario
       WHERE r.id_quadra = $1
       ORDER BY r.data_reserva, r.horario_inicio`,
      [id_quadra]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar reservas:', error);
    res.status(500).json({ error: 'Erro ao buscar reservas' });
  }
});

// Atualizar status da reserva
router.put('/:id_reserva/status', async (req, res) => {
  const { id_reserva } = req.params;
  const { status } = req.body;

  try {
    const result = await db.query(
      `UPDATE reservas
       SET status = $1
       WHERE id_reserva = $2
       RETURNING *`,
      [status, id_reserva]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reserva não encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar status da reserva:', error);
    res.status(500).json({ error: 'Erro ao atualizar status da reserva' });
  }
});

// Verificar disponibilidade de horário
router.get('/disponibilidade/:id_quadra', async (req, res) => {
  const { id_quadra } = req.params;
  const { data } = req.query;

  try {
    const result = await db.query(
      `SELECT horario_inicio, horario_fim
       FROM reservas
       WHERE id_quadra = $1 
       AND data_reserva = $2
       AND status != 'cancelada'
       ORDER BY horario_inicio`,
      [id_quadra, data]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao verificar disponibilidade:', error);
    res.status(500).json({ error: 'Erro ao verificar disponibilidade' });
  }
});

module.exports = router;