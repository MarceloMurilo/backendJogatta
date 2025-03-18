// src/routes/jogador/reservationRoutes.js

const express = require('express');
const router = express.Router();
const db = require('../../db');

// Criar nova reserva
router.post('/', async (req, res) => {
  try {
    const {
      id_quadra,
      id_usuario,
      data_reserva,
      horario_inicio,
      horario_fim,
      status = 'pendente',
      quantidade_jogadores,
      reservation_price,
      id_jogo
    } = req.body;

    // Caso precise de validações
    if (!id_quadra || !id_usuario || !data_reserva || !horario_inicio || !horario_fim) {
      return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
    }

    const result = await db.query(
      `INSERT INTO reservas (
        id_quadra,
        id_usuario,
        data_reserva,
        horario_inicio,
        horario_fim,
        status,
        quantidade_jogadores,
        reservation_price,
        id_jogo
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        id_quadra,
        id_usuario,
        data_reserva,
        horario_inicio,
        horario_fim,
        status,
        quantidade_jogadores || null,
        reservation_price || null,
        id_jogo || null
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('[reservationRoutes] Erro ao criar reserva:', error);
    res.status(500).json({ error: 'Erro ao criar reserva' });
  }
});

// Buscar reservas de uma quadra específica
router.get('/quadra/:id_quadra', async (req, res) => {
  try {
    const { id_quadra } = req.params;

    const result = await db.query(
      `SELECT r.*, u.nome as nome_usuario
         FROM reservas r
         JOIN usuario u ON r.id_usuario = u.id_usuario
        WHERE r.id_quadra = $1
        ORDER BY r.data_reserva, r.horario_inicio`,
      [id_quadra]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('[reservationRoutes] Erro ao buscar reservas:', error);
    res.status(500).json({ error: 'Erro ao buscar reservas' });
  }
});

// Atualizar status
router.put('/:id_reserva/status', async (req, res) => {
  try {
    const { id_reserva } = req.params;
    const { status } = req.body;

    const result = await db.query(
      `UPDATE reservas
         SET status = $1
       WHERE id_reserva = $2
       RETURNING *`,
      [status, id_reserva]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Reserva não encontrada' });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('[reservationRoutes] Erro ao atualizar status da reserva:', error);
    res.status(500).json({ error: 'Erro ao atualizar status da reserva' });
  }
});

// Verificar disponibilidade
router.get('/disponibilidade/:id_quadra', async (req, res) => {
  try {
    const { id_quadra } = req.params;
    const { data } = req.query;

    if (!data) {
      return res.status(400).json({ error: 'Data é obrigatória para verificar disponibilidade.' });
    }

    // Buscar reservas confirmadas ou pendentes (não-canceladas) nesse dia
    const result = await db.query(
      `SELECT horario_inicio, horario_fim
         FROM reservas
        WHERE id_quadra = $1
          AND data_reserva = $2
          AND status NOT IN ('cancelada', 'rejeitada')
        ORDER BY horario_inicio`,
      [id_quadra, data]
    );

    // Retorna apenas os intervalos ocupados. No front você cruza com as "janelas" de funcionamento
    // ou gera a array de slots livres/ocupados.
    return res.json(result.rows);
  } catch (error) {
    console.error('[reservationRoutes] Erro ao verificar disponibilidade:', error);
    res.status(500).json({ error: 'Erro ao verificar disponibilidade' });
  }
});

module.exports = router;
