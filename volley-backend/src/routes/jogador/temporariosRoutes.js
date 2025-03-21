// /routes/jogador/temporariosRoutes.js

const express = require('express');
const router = express.Router();
const db = require('../../config/db'); // Conexão com o banco de dados
const authMiddleware = require('../../middlewares/authMiddleware');
const roleMiddleware = require('../../middlewares/roleMiddleware');

/**
 * POST /api/temporarios/criar
 * Cria um jogador temporário vinculado ao organizador.
 */
router.post(
  '/criar',
  authMiddleware, 
  roleMiddleware(['organizador']), 
  async (req, res) => {
    try {
      const { organizador_id, nome, altura, passe, ataque, levantamento } = req.body;

      // Validações simples
      if (!organizador_id || !nome) {
        return res.status(400).json({
          message: 'organizador_id e nome do jogador são obrigatórios.',
        });
      }

      // Insere na tabela jogadores_temporarios
      const query = `
        INSERT INTO jogadores_temporarios 
          (organizador_id, nome, altura, passe, ataque, levantamento)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id_temporario, organizador_id, nome, altura, passe, ataque, levantamento
      `;
      const values = [
        organizador_id,
        nome.trim(),
        altura || 0,
        passe || 3,
        ataque || 3,
        levantamento || 3,
      ];

      const { rows } = await db.query(query, values);

      return res.status(201).json({
        message: 'Jogador temporário criado com sucesso!',
        jogador: rows[0],
      });
    } catch (error) {
      console.error('Erro ao criar jogador temporário:', error);
      return res.status(500).json({
        message: 'Erro ao criar jogador temporário.',
        details: error.message,
      });
    }
  }
);

/**
 * GET /api/temporarios/organizador/:organizador_id
 * Retorna todos os jogadores temporários criados por um organizador.
 */
router.get(
  '/organizador/:organizador_id',
  authMiddleware,
  roleMiddleware(['organizador']), 
  async (req, res) => {
    try {
      const { organizador_id } = req.params;

      const { rows } = await db.query(
        `SELECT * 
           FROM jogadores_temporarios
          WHERE organizador_id = $1
          ORDER BY id_temporario DESC
        `,
        [organizador_id]
      );

      return res.status(200).json(rows);
    } catch (error) {
      console.error('Erro ao listar jogadores temporários:', error);
      return res.status(500).json({
        message: 'Erro ao listar jogadores temporários.',
        details: error.message,
      });
    }
  }
);

/**
 * DELETE /api/temporarios/:id_temporario
 * Exclui um jogador temporário específico.
 */
router.delete(
  '/:id_temporario',
  authMiddleware,
  roleMiddleware(['organizador']), 
  async (req, res) => {
    try {
      const { id_temporario } = req.params;

      await db.query(
        `DELETE FROM jogadores_temporarios
          WHERE id_temporario = $1`,
        [id_temporario]
      );

      return res.status(200).json({
        message: 'Jogador temporário excluído com sucesso.',
      });
    } catch (error) {
      console.error('Erro ao excluir jogador temporário:', error);
      return res.status(500).json({
        message: 'Erro ao excluir jogador temporário.',
        details: error.message,
      });
    }
  }
);

module.exports = router;
