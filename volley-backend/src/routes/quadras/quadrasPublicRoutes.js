// src/routes/quadras/quadrasPublicRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../../db');

// [GET] /api/quadras -> Lista de TODAS as quadras (ou filtra por status, etc.)
router.get('/', async (req, res) => {
  try {
    // Se quiser juntar o nome da empresa, faça JOIN:
    const result = await db.query(`
      SELECT q.*,
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
