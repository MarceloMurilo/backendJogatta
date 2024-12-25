const express = require('express');
const router = express.Router();
const db = require('../../db'); // Conexão com o banco de dados
const authMiddleware = require('../../middlewares/authMiddleware');
const roleMiddleware = require('../../middlewares/roleMiddleware');

// Rota para atualizar a imagem de perfil
router.put(
  '/imagem_perfil',
  authMiddleware,
  roleMiddleware(['jogador', 'organizador']),
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

      res.status(200).json({
        message: 'Imagem de perfil atualizada com sucesso!',
        usuario: result.rows[0]
      });
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
  authMiddleware,
  roleMiddleware(['jogador', 'organizador']),
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

/* ===========================================================
   NOVOS ENDPOINTS PARA LIDAR COM AVALIAÇÕES DO ORGANIZADOR
   (USADOS PELO FRONTEND /api/avaliacoes/organizador/:organizador_id,
   E /api/avaliacoes/salvar)
=========================================================== */

// GET - Retorna todas as avaliações de um determinado organizador
router.get(
  '/avaliacoes/organizador/:organizador_id',
  authMiddleware,
  roleMiddleware(['jogador', 'organizador']),
  async (req, res) => {
    try {
      const { organizador_id} = req.params;

      const result = await db.query(
        `SELECT usuario_id, passe, ataque, levantamento
         FROM avaliacoes
         WHERE organizador_id = $1
        `,
        [organizador_id]
      );

      res.status(200).json(result.rows);
    } catch (error) {
      console.error('Erro ao buscar avaliacoes do organizador:', error);
      res.status(500).json({ message: 'Erro ao buscar avaliacoes do organizador.', error });
    }
  }
);

// POST - Salva ou atualiza avaliação de um jogador para determinado organizador
router.post(
  '/avaliacoes/salvar',
  authMiddleware,
  roleMiddleware(['jogador', 'organizador']),
  async (req, res) => {
    try {
      const { organizador_id, usuario_id, passe, ataque, levantamento } = req.body;

      if (!organizador_id || !usuario_id) {
        return res.status(400).json({ message: 'organizador_id e usuario_id são obrigatórios.' });
      }

      await db.query(
        `INSERT INTO avaliacoes (usuario_id, organizador_id, passe, ataque, levantamento)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (usuario_id, organizador_id)
         DO UPDATE SET 
           passe = EXCLUDED.passe,
           ataque = EXCLUDED.ataque,
           levantamento = EXCLUDED.levantamento
        `,
        [usuario_id, organizador_id, passe || 0, ataque || 0, levantamento || 0]
      );

      return res.status(200).json({ message: 'Avaliação salva/atualizada com sucesso.' });
    } catch (error) {
      console.error('Erro ao salvar avaliacoes:', error);
      res.status(500).json({ message: 'Erro ao salvar avaliacoes.', error });
    }
  }
);

module.exports = router;
