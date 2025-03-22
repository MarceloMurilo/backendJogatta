const express = require('express');
const router = express.Router();
const db = require('../../config/db');

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

/**
 * [GET] Listar status da fila e financeiro da reserva
 */
router.get('/fila/:id_reserva', async (req, res) => {
  const { id_reserva } = req.params;

  try {
    // Busca dados da reserva e quadra
    const reservaResult = await db.query(
      `SELECT r.valor_pago, q.preco_hora, q.percentual_antecipado
         FROM reservas r
         JOIN quadras q ON q.id_quadra = r.id_quadra
        WHERE r.id_reserva = $1`,
      [id_reserva]
    );

    if (reservaResult.rows.length === 0) {
      return res.status(404).json({ message: 'Reserva não encontrada.' });
    }

    const { valor_pago, preco_hora, percentual_antecipado } = reservaResult.rows[0];
    const valorMinimo = (percentual_antecipado / 100) * preco_hora;
    const percentualAtual = ((valor_pago / preco_hora) * 100).toFixed(1);

    // Busca fila de organizadores
    const filaResult = await db.query(
      `SELECT f.id, f.organizador_id, u.nome as nome_organizador
         FROM fila_reservas f
         JOIN usuario u ON u.id_usuario = f.organizador_id
        WHERE f.reserva_id = $1
        ORDER BY f.data_entrada ASC`,
      [id_reserva]
    );

    const fila = filaResult.rows.map((organizador) => ({
      id: organizador.id,
      organizador_id: organizador.organizador_id,
      nome: organizador.nome_organizador,
      metodo_pagamento_validado: true // Simulação, no futuro pode buscar real
    }));

    return res.json({
      valor_pago,
      preco_hora,
      percentual_necessario: percentual_antecipado,
      percentual_atual: percentualAtual,
      valor_minimo_necessario: valorMinimo,
      fila
    });
  } catch (error) {
    console.error('[ownerReservations] Erro ao buscar fila:', error);
    return res.status(500).json({
      message: 'Erro ao buscar fila da reserva',
      details: error.message
    });
  }
});

module.exports = router;
