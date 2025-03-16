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
    // Buscar empresas com informações básicas de quadras
    const result = await pool.query(`
      SELECT e.*,
             COALESCE(json_agg(
               json_build_object(
                 'id', q.id_quadra,
                 'nome', q.nome,
                 'preco_hora', q.preco_hora,
                 'promocao_ativa', q.promocao_ativa,
                 'descricao_promocao', q.descricao_promocao,
                 'rede_disponivel', q.rede_disponivel,
                 'bola_disponivel', q.bola_disponivel,
                 'observacoes', q.observacoes,
                 'foto', q.foto
               )
             ) FILTER (WHERE q.id_quadra IS NOT NULL), '[]') as quadras
        FROM empresas e
        LEFT JOIN quadras q ON e.id_empresa = q.id_empresa
       GROUP BY e.id_empresa
       ORDER BY e.nome
    `);

    return res.json(result.rows.map(empresa => ({
      ...empresa,
      quadras: empresa.quadras === '[]' ? [] : empresa.quadras
    })));
  } catch (error) {
    console.error('Erro ao listar empresas:', error);
    return res.status(500).json({ message: 'Erro ao listar empresas', error: error.message });
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

    // Buscar as quadras associadas à empresa – usando SELECT com as colunas desejadas
    const quadRes = await pool.query(`
      SELECT id_quadra,
             id_empresa,
             nome,
             preco_hora,
             promocao_ativa,
             descricao_promocao,
             rede_disponivel,
             bola_disponivel,
             observacoes,
             foto
        FROM public.quadras
       WHERE id_empresa = $1
    `, [id]);
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
      `SELECT id_quadra,
              id_empresa,
              nome,
              preco_hora,
              promocao_ativa,
              descricao_promocao,
              rede_disponivel,
              bola_disponivel,
              observacoes,
              foto
         FROM public.quadras
        WHERE id_empresa = $1`,
      [id]
    );
    return res.status(200).json(quadRes.rows);
  } catch (error) {
    console.error('Erro ao buscar quadras da empresa:', error);
    return res.status(500).json({ message: 'Erro ao buscar quadras' });
  }
});

module.exports = router;
