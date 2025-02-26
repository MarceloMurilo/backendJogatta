// src/routes/empresasRoutes.js
const express = require('express');
const router = express.Router();
const pool = require('../db');

// [GET] /api/empresas
//    Se passar ?includeQuadras=true, retorna cada empresa com um array "quadras".
//    Se não passar, retorna apenas as empresas.
router.get('/', async (req, res) => {
  try {
    const includeQuadras = req.query.includeQuadras === 'true';

    if (!includeQuadras) {
      // Só retorna a lista de empresas
      const empRes = await pool.query('SELECT * FROM public.empresas');
      return res.json(empRes.rows);
    }

    // Se includeQuadras = true, retorna cada empresa com suas quadras
    // 1) Buscar todas as empresas
    const empRes = await pool.query('SELECT * FROM public.empresas');
    const empresas = empRes.rows;

    // 2) Buscar todas as quadras
    const quadRes = await pool.query('SELECT * FROM public.quadras');

    // 3) Agrupar quadras por id_empresa
    const quadrasMap = {};
    quadRes.rows.forEach((q) => {
      if (!quadrasMap[q.id_empresa]) {
        quadrasMap[q.id_empresa] = [];
      }
      quadrasMap[q.id_empresa].push(q);
    });

    // 4) Montar objeto final
    const resultado = empresas.map((emp) => ({
      ...emp,
      quadras: quadrasMap[emp.id_empresa] || [],
    }));

    return res.json(resultado);
  } catch (error) {
    console.error('Erro ao listar empresas e quadras:', error);
    return res.status(500).json({ message: 'Erro ao listar' });
  }
});

// [GET] /api/empresas/:id
//    Retorna 1 empresa (se existir) e suas quadras no campo "quadras"
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar a empresa
    const empRes = await pool.query('SELECT * FROM public.empresas WHERE id_empresa = $1', [id]);
    if (empRes.rows.length === 0) {
      return res.status(404).json({ message: 'Empresa não encontrada' });
    }
    const empresa = empRes.rows[0];

    // Buscar as quadras dessa empresa
    const quadRes = await pool.query('SELECT * FROM public.quadras WHERE id_empresa = $1', [id]);

    // Anexar ao objeto
    empresa.quadras = quadRes.rows;

    return res.json(empresa);
  } catch (error) {
    console.error('Erro ao buscar empresa e quadras:', error);
    return res.status(500).json({ message: 'Erro ao buscar empresa e quadras' });
  }
});

module.exports = router;
