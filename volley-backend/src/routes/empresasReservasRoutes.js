const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middlewares/authMiddleware');

// Aplica o middleware de autenticação
router.use(authMiddleware);

/**
 * GET /api/empresas/reservas/:id_empresa/reservas
 * Query: status (opcional, por exemplo: pendente)
 * Retorna as reservas da empresa, filtrando pelo status se fornecido.
 */
router.get('/:id_empresa/reservas', async (req, res) => {
  const { id_empresa } = req.params;
  const { status } = req.query; // ex: status=pendente

  try {
    console.log('Executando consulta SQL: ', `
      SELECT r.id_reserva, r.id_jogo, r.data_reserva, r.horario_inicio, r.horario_fim, r.status,
             j.descricao, j.id_usuario, u.nome AS organizador, j.limite_jogadores as quantidade_jogadores, j.nome_jogo
        FROM reservas r
        JOIN jogos j ON r.id_jogo = j.id_jogo
        JOIN usuario u ON j.id_usuario = u.id_usuario
       WHERE r.id_empresa = $1
       ${status ? 'AND r.status = $2' : ''}
       ORDER BY r.data_reserva, r.horario_inicio
     | Parâmetros: ${JSON.stringify(status ? [id_empresa, status] : [id_empresa])}`);
    
    const query = `
      SELECT r.id_reserva, r.id_jogo, r.data_reserva, r.horario_inicio, r.horario_fim, r.status,
             j.descricao, j.id_usuario, u.nome AS organizador, j.limite_jogadores as quantidade_jogadores, j.nome_jogo
        FROM reservas r
        JOIN jogos j ON r.id_jogo = j.id_jogo
        JOIN usuario u ON j.id_usuario = u.id_usuario
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