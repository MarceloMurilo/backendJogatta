const express = require('express');
const router = express.Router();
const db = require('../../db'); // Conexão com o banco de dados
const authMiddleware = require('../../middlewares/authMiddleware');
const roleMiddleware = require('../../middlewares/roleMiddleware');

// Middleware para log de requisições (opcional)
router.use((req, res, next) => {
  console.log(`=== Nova requisição recebida ===`);
  console.log(`Método: ${req.method}`);
  console.log(`URL: ${req.originalUrl}`);
  console.log(`Body:`, req.body);
  console.log(`Params:`, req.params);
  console.log(`==============================`);
  next();
});

// Rota para salvar ou atualizar avaliações
router.post(
  '/salvar',
  authMiddleware,
  roleMiddleware(['organizador', 'jogador']),
  async (req, res) => {
    const { organizador_id, usuario_id, passe, ataque, levantamento } = req.body;

    if (!organizador_id || !usuario_id) {
      return res.status(400).json({ message: 'Organizador e Usuário são obrigatórios.' });
    }

    try {
      await db.query(
        `INSERT INTO avaliacoes (organizador_id, usuario_id, passe, ataque, levantamento)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (organizador_id, usuario_id)
         DO UPDATE SET passe = $3, ataque = $4, levantamento = $5`,
        [organizador_id, usuario_id, passe, ataque, levantamento]
      );

      res.status(200).json({ message: 'Avaliação salva ou atualizada com sucesso!' });
    } catch (error) {
      console.error('Erro ao salvar avaliação:', error);
      res.status(500).json({ message: 'Erro ao salvar avaliação.' });
    }
  }
);

// Rota para buscar avaliações feitas pelo organizador
router.get(
  '/organizador/:organizador_id',
  authMiddleware,
  roleMiddleware(['organizador', 'jogador']),
  async (req, res) => {
    const { organizador_id } = req.params;

    try {
      const result = await db.query(
        `SELECT usuario_id, passe, ataque, levantamento
         FROM avaliacoes
         WHERE organizador_id = $1`,
        [organizador_id]
      );

      res.status(200).json(result.rows);
    } catch (error) {
      console.error('Erro ao buscar avaliações:', error);
      res.status(500).json({ message: 'Erro ao buscar avaliações.' });
    }
  }
);

// Rota para buscar uma avaliação específica
router.get(
  '/:organizador_id/:usuario_id',
  authMiddleware,
  roleMiddleware(['organizador', 'jogador']),
  async (req, res) => {
    const { organizador_id, usuario_id } = req.params;

    try {
      const result = await db.query(
        `SELECT usuario_id, passe, ataque, levantamento
         FROM avaliacoes
         WHERE organizador_id = $1 AND usuario_id = $2`,
        [organizador_id, usuario_id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Avaliação não encontrada.' });
      }

      res.status(200).json(result.rows[0]);
    } catch (error) {
      console.error('Erro ao buscar avaliação específica:', error);
      res.status(500).json({ message: 'Erro ao buscar avaliação específica.' });
    }
  }
);

// Rota para listar todas as avaliações (caso precise retornar todas de uma vez)
router.get(
  '/organizador/:organizador_id/todas',
  authMiddleware,
  roleMiddleware(['organizador', 'jogador']),
  async (req, res) => {
    const { organizador_id } = req.params;

    try {
      const result = await db.query(
        `SELECT usuario_id, passe, ataque, levantamento
         FROM avaliacoes
         WHERE organizador_id = $1`,
        [organizador_id]
      );

      res.status(200).json(result.rows);
    } catch (error) {
      console.error('Erro ao listar todas as avaliações do organizador:', error);
      res.status(500).json({ message: 'Erro ao listar avaliações.' });
    }
  }
);

module.exports = router;
