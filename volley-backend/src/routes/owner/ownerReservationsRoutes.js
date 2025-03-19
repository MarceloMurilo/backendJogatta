// src/routes/owner/ownerReservationsRoutes.js

const express = require('express');
const router = express.Router();
const db = require('../../db');

/**
 * [GET] Listar reservas pendentes do dono
 * Exemplo simples sem filtrar a empresa.
 */
router.get('/pendentes', async (req, res) => {
  try {
    const query = `
      SELECT r.id_reserva,
             r.data_reserva,
             r.horario_inicio,
             r.horario_fim,
             r.status,
             r.id_jogo,
             j.nome_jogo,
             j.descricao as descricao_jogo,
             u.id_usuario as id_organizador,
             u.nome as nome_organizador,
             q.id_quadra,
             q.nome as nome_quadra,
             q.preco_hora
        FROM reservas r
   LEFT JOIN jogos j ON r.id_jogo = j.id_jogo
   LEFT JOIN usuario u ON j.id_usuario = u.id_usuario
   LEFT JOIN quadras q ON r.id_quadra = q.id_quadra
       WHERE r.status = 'pendente'
       ORDER BY r.data_reserva, r.horario_inicio
    `;
    const result = await db.query(query);
    return res.json(result.rows);
  } catch (error) {
    console.error('[ownerReservations] Erro ao listar pendentes:', error);
    return res.status(500).json({
      message: 'Erro ao listar reservas pendentes',
      details: error.message
    });
  }
});

/**
 * [PUT] Confirmar uma reserva
 */
router.put('/:id_reserva/confirmar', async (req, res) => {
  try {
    const { id_reserva } = req.params;
    const result = await db.query(
      `UPDATE reservas
         SET status = 'confirmada'
       WHERE id_reserva = $1
       RETURNING *`,
      [id_reserva]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Reserva não encontrada.' });
    }

    return res.json({
      message: 'Reserva confirmada com sucesso.',
      reserva: result.rows[0]
    });
  } catch (error) {
    console.error('[ownerReservations] Erro ao confirmar reserva:', error);
    return res.status(500).json({
      message: 'Erro ao confirmar reserva',
      details: error.message
    });
  }
});

/**
 * [PUT] Rejeitar uma reserva
 */
router.put('/:id_reserva/rejeitar', async (req, res) => {
  try {
    const { id_reserva } = req.params;
    const result = await db.query(
      `UPDATE reservas
         SET status = 'rejeitada'
       WHERE id_reserva = $1
       RETURNING *`,
      [id_reserva]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Reserva não encontrada.' });
    }

    return res.json({
      message: 'Reserva rejeitada com sucesso.',
      reserva: result.rows[0]
    });
  } catch (error) {
    console.error('[ownerReservations] Erro ao rejeitar reserva:', error);
    return res.status(500).json({
      message: 'Erro ao rejeitar reserva',
      details: error.message
    });
  }
});

module.exports = router;
