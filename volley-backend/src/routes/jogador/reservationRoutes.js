const express = require('express');
const router = express.Router();
const db = require('../../db');

// Criar uma nova reserva
router.post('/', async (req, res) => {
  const {
    id_jogo,
    id_empresa,
    id_quadra,
    data_reserva,
    horario_inicio,
    horario_fim,
    status = 'pendente'
  } = req.body;

  try {
    const result = await db.query(
      `INSERT INTO reservas (
        id_jogo,
        id_empresa,
        id_quadra,
        data_reserva,
        horario_inicio,
        horario_fim,
        status,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *`,
      [id_jogo, id_empresa, id_quadra, data_reserva, horario_inicio, horario_fim, status]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar reserva:', error);
    res.status(500).json({ error: 'Erro ao criar reserva' });
  }
});

// Buscar reservas por jogo
router.get('/jogo/:id_jogo', async (req, res) => {
  const { id_jogo } = req.params;

  try {
    const result = await db.query(
      `SELECT r.*, e.nome as empresa_nome, q.nome as quadra_nome
       FROM reservas r
       JOIN empresas e ON r.id_empresa = e.id_empresa
       JOIN quadras q ON r.id_quadra = q.id_quadra
       WHERE r.id_jogo = $1`,
      [id_jogo]
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
       SET status = $1,
           updated_at = NOW()
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

module.exports = router;