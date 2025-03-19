// src/routes/owner/courtManagementRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../../db');

// [POST] Criar nova quadra
router.post('/', async (req, res) => {
  try {
    const {
      id_empresa,
      nome,
      preco_hora,
      promocao_ativa = false,
      descricao_promocao,
      rede_disponivel = false,
      bola_disponivel = false,
      observacoes,
      foto
      // se quiser 'horarios_config', adicione aqui
    } = req.body;

    if (!id_empresa || !nome) {
      return res.status(400).json({
        message: 'id_empresa e nome são obrigatórios.'
      });
    }

    const result = await pool.query(
      `INSERT INTO quadras
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
        foto || null
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('[owner/courtManagement] Erro ao criar quadra:', error);
    return res.status(500).json({
      message: 'Erro ao criar quadra',
      details: error.message
    });
  }
});

// [GET] Lista quadras
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT q.*, e.nome AS nome_empresa
        FROM quadras q
   LEFT JOIN empresas e ON q.id_empresa = e.id_empresa
       ORDER BY q.id_quadra DESC
    `;
    const result = await pool.query(query);
    return res.json(result.rows);
  } catch (error) {
    console.error('[owner/courtManagement] Erro ao listar quadras:', error);
    return res.status(500).json({
      message: 'Erro ao listar quadras',
      details: error.message
    });
  }
});

// [PUT] Atualizar quadra
router.put('/:id_quadra', async (req, res) => {
  try {
    const { id_quadra } = req.params;
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

    const result = await pool.query(
      `UPDATE quadras
         SET nome = COALESCE($1, nome),
             preco_hora = COALESCE($2, preco_hora),
             promocao_ativa = COALESCE($3, promocao_ativa),
             descricao_promocao = COALESCE($4, descricao_promocao),
             rede_disponivel = COALESCE($5, rede_disponivel),
             bola_disponivel = COALESCE($6, bola_disponivel),
             observacoes = COALESCE($7, observacoes),
             foto = COALESCE($8, foto)
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
        id_quadra
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Quadra não encontrada.' });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('[owner/courtManagement] Erro ao atualizar quadra:', error);
    return res.status(500).json({
      message: 'Erro ao atualizar quadra',
      details: error.message
    });
  }
});

// [DELETE] Deleta a quadra
router.delete('/:id_quadra', async (req, res) => {
  try {
    const { id_quadra } = req.params;

    const result = await pool.query(
      'DELETE FROM quadras WHERE id_quadra = $1 RETURNING *',
      [id_quadra]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Quadra não encontrada.' });
    }
    return res.json({ message: 'Quadra deletada com sucesso.' });
  } catch (error) {
    console.error('[owner/courtManagement] Erro ao deletar quadra:', error);
    return res.status(500).json({
      message: 'Erro ao deletar quadra',
      details: error.message
    });
  }
});

module.exports = router;
