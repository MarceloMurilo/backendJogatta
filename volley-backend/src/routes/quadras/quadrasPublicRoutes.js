// src/routes/quadras/quadrasPublicRoutes.js

const express = require('express');
const router = express.Router();
const db = require('../../db');

// [GET] /api/quadras -> Lista de TODAS as quadras (ou filtra por status, etc.)
router.get('/', async (req, res) => {
  try {
    // Seleciona as colunas desejadas, incluindo os novos campos
    const result = await db.query(`
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
        FROM public.quadras q
   LEFT JOIN public.empresas e ON q.id_empresa = e.id_empresa
    `);
    return res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar quadras (public):', error);
    return res.status(500).json({ message: 'Erro ao listar quadras' });
  }
});

module.exports = router;
