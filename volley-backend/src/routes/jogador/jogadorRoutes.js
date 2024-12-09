// routes/jogadores/jogadorRoutes.js

const express = require('express');
const router = express.Router();
const db = require('../../db'); // Conexão com o banco de dados
const authMiddleware = require('../../middlewares/authMiddleware');
const roleMiddleware = require('../../middlewares/roleMiddleware');

// Rota para atualizar a imagem de perfil
router.put(
  '/imagem_perfil',
  authMiddleware, // Verifica o token e autenticação
  roleMiddleware(['jogador', 'organizador']), // Garante que o papel seja permitido
  async (req, res) => {
    try {
      const { id_usuario, imagem_perfil } = req.body;

      if (!id_usuario || !imagem_perfil) {
        return res.status(400).json({ message: 'ID do usuário e URL da imagem são obrigatórios.' });
      }

      const result = await db.query(
        'UPDATE usuario SET imagem_perfil = $1 WHERE id_usuario = $2 RETURNING *',
        [imagem_perfil, id_usuario]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ message: 'Usuário não encontrado.' });
      }

      res.status(200).json({ message: 'Imagem de perfil atualizada com sucesso!', usuario: result.rows[0] });
    } catch (error) {
      console.error('Erro ao atualizar imagem de perfil:', error);
      res.status(500).json({ message: 'Erro ao atualizar imagem de perfil.' });
    }
  }
);

// Rota para obter informações do perfil do jogador
router.get(
  '/perfil',
  authMiddleware, 
  roleMiddleware(['jogador', 'organizador']), 
  async (req, res) => {
    try {
      const userId = req.user.id;

      const result = await db.query(
        'SELECT id_usuario, nome, email, imagem_perfil FROM usuario WHERE id_usuario = $1',
        [userId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ message: 'Usuário não encontrado.' });
      }

      res.status(200).json(result.rows[0]);
    } catch (error) {
      console.error('Erro ao buscar perfil do jogador:', error);
      res.status(500).json({ message: 'Erro ao buscar perfil do jogador.' });
    }
  }
);

// **Nova Rota: Listar Jogadores de um Jogo Específico**
router.get(
  '/listar/:jogoId',
  authMiddleware, // Verifica o token e autenticação
  roleMiddleware(['jogador', 'organizador']), // Garante que o papel seja permitido
  async (req, res) => {
    const { jogoId } = req.params;

    if (!jogoId) {
      return res.status(400).json({ message: 'ID do jogo é obrigatório.' });
    }

    try {
      const result = await db.query(
        `SELECT pj.id_usuario, u.nome, u.email, 
                COALESCE(a.passe, 0) AS passe, 
                COALESCE(a.ataque, 0) AS ataque, 
                COALESCE(a.levantamento, 0) AS levantamento
         FROM participacao_jogos pj
         JOIN usuario u ON pj.id_usuario = u.id_usuario
         LEFT JOIN avaliacoes a ON pj.id_usuario = a.usuario_id
         WHERE pj.id_jogo = $1`,
        [jogoId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Nenhum jogador encontrado para este jogo.' });
      }

      res.status(200).json(result.rows);
    } catch (error) {
      console.error('Erro ao listar jogadores:', error);
      res.status(500).json({ message: 'Erro interno ao listar jogadores.', error });
    }
  }
);

module.exports = router;
