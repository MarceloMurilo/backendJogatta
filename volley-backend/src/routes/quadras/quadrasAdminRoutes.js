// src/routes/quadras/quadrasAdminRoutes.js

const express = require('express');
const pool = require('../../db'); // Importa a conexão com o banco
const router = express.Router();

// [POST] Rota para cadastrar uma nova quadra (Create)
router.post('/', async (req, res) => {
  const {
    id_empresa,
    nome,
    preco_hora,
    promocao_ativa,
    descricao_promocao,
    rede_disponivel,
    bola_disponivel,
    observacoes,
    foto
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO public.quadras
        (id_empresa, nome, preco_hora, promocao_ativa, descricao_promocao,
         rede_disponivel, bola_disponivel, observacoes, foto)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        id_empresa,
        nome,
        preco_hora,
        promocao_ativa,
        descricao_promocao,
        rede_disponivel,
        bola_disponivel,
        observacoes,
        foto
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao cadastrar a quadra:', error);
    res.status(500).json({ error: 'Erro ao cadastrar a quadra', details: error.message });
  }
});

// [GET] Rota para listar todas as quadras (Read)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM public.quadras');
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Erro ao listar as quadras:', error);
    res.status(500).json({ error: 'Erro ao listar as quadras', details: error.message });
  }
});

// [GET] Rota para listar uma única quadra por ID (Read)
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'SELECT * FROM public.quadras WHERE id_quadra = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quadra não encontrada' });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao buscar a quadra:', error);
    res.status(500).json({ error: 'Erro ao buscar a quadra', details: error.message });
  }
});

// [PUT] Rota para atualizar uma quadra por ID (Update)
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    nome,
    preco_hora,
    promocao_ativa,
    descricao_promocao,
    rede_disponivel,
    bola_disponivel,
    observacoes,
    foto
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE public.quadras
         SET nome = $1,
             preco_hora = $2,
             promocao_ativa = $3,
             descricao_promocao = $4,
             rede_disponivel = $5,
             bola_disponivel = $6,
             observacoes = $7,
             foto = $8
       WHERE id_quadra = $9
       RETURNING *`,
      [
        nome,
        preco_hora,
        promocao_ativa,
        descricao_promocao,
        rede_disponivel,
        bola_disponivel,
        observacoes,
        foto,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quadra não encontrada' });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar a quadra:', error);
    res.status(500).json({ error: 'Erro ao atualizar a quadra', details: error.message });
  }
});

// [DELETE] Rota para deletar uma quadra por ID (Delete)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM public.quadras WHERE id_quadra = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quadra não encontrada' });
    }

    res.status(200).json({ message: 'Quadra deletada com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar a quadra:', error);
    res.status(500).json({ error: 'Erro ao deletar a quadra', details: error.message });
  }
});

module.exports = router;
