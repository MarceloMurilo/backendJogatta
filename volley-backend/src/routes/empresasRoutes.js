// src/routes/empresasRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../db');

// [POST] /api/empresas
router.post('/', async (req, res) => {
  try {
    const { nome, localizacao, contato } = req.body;
    // Se a coluna na tabela é "endereco", atribuímos localizacao a endereco.
    const endereco = localizacao;

    const result = await pool.query(
      `INSERT INTO public.empresas (nome, endereco, contato)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [nome, endereco, contato]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar empresa:', error);
    return res.status(500).json({
      message: 'Erro ao criar empresa',
      details: error.message,
    });
  }
});

// [GET] /api/empresas
// Se passar ?includeQuadras=true, retorna cada empresa com um array "quadras".
router.get('/', async (req, res) => {
  try {
    const includeQuadras = req.query.includeQuadras === 'true';

    if (!includeQuadras) {
      // Retorna apenas a lista de empresas
      const empRes = await pool.query('SELECT * FROM public.empresas');
      return res.json(empRes.rows);
    }

    // Se includeQuadras=true, retorna cada empresa com suas quadras associadas.
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

    // 4) Montar objeto final para cada empresa
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
// Retorna uma empresa (se existir) e suas quadras no campo "quadras"
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar a empresa pelo ID
    const empRes = await pool.query(
      'SELECT * FROM public.empresas WHERE id_empresa = $1',
      [id]
    );
    if (empRes.rows.length === 0) {
      return res.status(404).json({ message: 'Empresa não encontrada' });
    }
    const empresa = empRes.rows[0];

    // Buscar as quadras associadas à empresa
    const quadRes = await pool.query(
      'SELECT * FROM public.quadras WHERE id_empresa = $1',
      [id]
    );
    empresa.quadras = quadRes.rows;

    return res.json(empresa);
  } catch (error) {
    console.error('Erro ao buscar empresa e quadras:', error);
    return res.status(500).json({ message: 'Erro ao buscar empresa e quadras' });
  }
});

// [GET] /api/empresas/:id/quadras
// Retorna apenas as quadras da empresa (sem os dados da empresa)
router.get('/:id/quadras', async (req, res) => {
  try {
    const { id } = req.params;
    // Buscar todas as quadras dessa empresa
    const quadRes = await pool.query(
      'SELECT * FROM public.quadras WHERE id_empresa = $1',
      [id]
    );
    return res.status(200).json(quadRes.rows);
  } catch (error) {
    console.error('Erro ao buscar quadras da empresa:', error);
    return res.status(500).json({ message: 'Erro ao buscar quadras' });
  }
});

module.exports = router;
