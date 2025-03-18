// src/routes/quadras/quadrasPublicRoutes.js

const express = require('express');
const router = express.Router();
const db = require('../../db');

// [GET] /api/quadras -> Lista de TODAS as quadras
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT q.id_quadra,
             q.id_empresa,
             q.nome,
             q.preco_hora,
             q.promocao_ativa,
             q.descricao_promocao,
             q.rede_disponivel,
             q.bola_disponivel,
             q.observacoes,
             q.foto,
             e.nome AS nome_empresa
        FROM quadras q
   LEFT JOIN empresas e ON q.id_empresa = e.id_empresa
       ORDER BY q.id_quadra DESC
    `;
    const result = await db.query(query);
    return res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar quadras (públicas):', error);
    return res.status(500).json({ message: 'Erro ao listar quadras' });
  }
});

module.exports = router;
