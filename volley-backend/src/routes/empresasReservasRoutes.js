// src/routes/empresasReservasRoutes.js

const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');

// Aplica o middleware de autenticação
router.use(authMiddleware);

/**
 * GET /api/empresas/:id_empresa/reservas
 * Query: status (opcional, por exemplo: pendente)
 * Retorna as reservas da empresa, filtrando pelo status se fornecido.
 */
router.get('/:id_empresa/reservas', async (req, res) => {
  const { id_empresa } = req.params;
  const { status } = req.query; // ex: status=pendente

  try {
    const query = `
      SELECT r.id_reserva, r.id_jogo, r.data_reserva, r.horario_inicio, r.horario_fim, r.status,
             r.descricao, u.nome AS organizador, r.quantidade_jogadores
        FROM reservas r
        JOIN usuario u ON r.id_usuario = u.id_usuario
       WHERE r.id_empresa = $1
       ${status ? 'AND r.status = $2' : ''}
       ORDER BY r.data_reserva, r.horario_inicio
    `;
    const params = status ? [id_empresa, status] : [id_empresa];
    const result = await db.query(query, params);
    return res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar reservas da empresa:', error.message);
    return res.status(500).json({ error: 'Erro ao buscar reservas da empresa.' });
  }
});

module.exports = router;
