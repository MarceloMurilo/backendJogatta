// src/routes/quadras/quadrasAdminRoutes.js

// Esse arquivo é relacionado as permissões do superadmin

const express = require('express');
const pool = require('../../config/db');
const router = express.Router();

// [POST] Criar quadra (superadmin)
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
    foto,
    hora_abertura,
    hora_fechamento
  } = req.body;

  try {
    if (!id_empresa || !nome || !hora_abertura || !hora_fechamento) {
      return res.status(400).json({
        message: 'id_empresa, nome, hora_abertura e hora_fechamento são obrigatórios.'
      });
    }

    const result = await pool.query(
      `INSERT INTO quadras
        (id_empresa, nome, preco_hora, promocao_ativa, descricao_promocao,
         rede_disponivel, bola_disponivel, observacoes, foto, hora_abertura, hora_fechamento)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        foto,
        hora_abertura,
        hora_fechamento
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao cadastrar a quadra (superadmin):', error);
    res.status(500).json({ error: 'Erro ao cadastrar a quadra', details: error.message });
  }
});

// [GET] Listar todas as quadras
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM quadras');
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Erro ao listar quadras (superadmin):', error);
    res.status(500).json({ error: 'Erro ao listar quadras', details: error.message });
  }
});

// [GET] Quadra específica
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'SELECT * FROM quadras WHERE id_quadra = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quadra não encontrada' });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao buscar quadra:', error);
    res.status(500).json({ error: 'Erro ao buscar quadra', details: error.message });
  }
});

// [PUT] Atualizar quadra
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
      `UPDATE quadras
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
    console.error('Erro ao atualizar quadra:', error);
    res.status(500).json({ error: 'Erro ao atualizar quadra', details: error.message });
  }
});

// [DELETE] Excluir quadra
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM quadras WHERE id_quadra = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quadra não encontrada' });
    }

    res.status(200).json({ message: 'Quadra deletada com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar quadra:', error);
    res.status(500).json({ error: 'Erro ao deletar quadra', details: error.message });
  }
});

module.exports = router;
