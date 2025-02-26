// src/routes/quadras/quadrasPublicRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../../db'); // Ajuste o caminho se necessário

// [GET] /api/quadras -> Lista quadras para qualquer usuário (ou usuário logado, se preferir)
router.get('/', async (req, res) => {
  try {
    // Ajuste a query conforme seu schema do banco
    const result = await db.query('SELECT * FROM quadras');
    return res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar quadras (public):', error);
    return res.status(500).json({ message: 'Erro ao listar quadras' });
  }
});

module.exports = router;
