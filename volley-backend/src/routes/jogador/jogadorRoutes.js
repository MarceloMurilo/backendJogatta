// /routes/jogador/jogadorRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');
const roleMiddleware = require('../../middlewares/roleMiddleware');

// Rota para atualizar a imagem de perfil
router.put(
  '/imagem_perfil',
  authMiddleware,
  roleMiddleware(['jogador', 'organizador'], { optionalIdJogo: true }), // Ajuste conforme a regra de negócio
  async (req, res) => {
    try {
      const { id_usuario, imagem_perfil } = req.body;

      if (!id_usuario || !imagem_perfil) {
        return res
          .status(400)
          .json({ message: 'ID do usuário e URL da imagem são obrigatórios.' });
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
        usuario: result.rows[0],
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
  // Removido roleMiddleware pois não temos id_jogo aqui
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
  roleMiddleware(['jogador', 'organizador'], { optionalIdJogo: false }), // `id_jogo` é obrigatório aqui
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
  roleMiddleware(['jogador', 'organizador'], { optionalIdJogo: true }), // `id_jogo` opcional
  async (req, res) => {
    try {
      const { organizador_id } = req.params;

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
  roleMiddleware(['jogador', 'organizador'], { optionalIdJogo: true }), // `id_jogo` opcional
  async (req, res) => {
    try {
      const { organizador_id, usuario_id, passe, ataque, levantamento, id_jogo } = req.body;

      if (!organizador_id || !usuario_id) {
        return res.status(400).json({ message: 'organizador_id e usuario_id são obrigatórios.' });
      }

      // Validação adicional: se `id_jogo` for fornecido, validar que o usuário pertence ao jogo
      if (id_jogo) {
        const verificaParticipacao = await db.query(
          'SELECT * FROM participacao_jogos WHERE id_jogo = $1 AND id_usuario = $2',
          [id_jogo, usuario_id]
        );

        if (verificaParticipacao.rowCount === 0) {
          return res.status(400).json({ message: 'Usuário não participa deste jogo.' });
        }
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

// Rota para equilibrar times
router.post(
  '/equilibrar-times',
  authMiddleware,
  roleMiddleware(['jogador', 'organizador'], { optionalIdJogo: true }),
  async (req, res) => {
    try {
      const { organizador_id, id_jogo, tamanho_time, jogadores } = req.body;

      // Validações básicas
      if (!organizador_id || !tamanho_time || !jogadores || !Array.isArray(jogadores)) {
        return res.status(400).json({
          message: 'organizador_id, tamanho_time e jogadores são obrigatórios.',
        });
      }

      // Lógica para equilibrar times
      const timesEquilibrados = equilibrarJogadores(jogadores, tamanho_time);

      // Pegar os IDs de todos os jogadores para buscar detalhes
      const jogadorIds = jogadores.map((j) => j.id_usuario);
      
      const jogadoresDetalhes = await db.query(
        `SELECT id_usuario, nome, 
                COALESCE(passe, 0) AS passe, 
                COALESCE(ataque, 0) AS ataque, 
                COALESCE(levantamento, 0) AS levantamento
         FROM usuario
         LEFT JOIN avaliacoes 
         ON usuario.id_usuario = avaliacoes.usuario_id
         WHERE id_usuario = ANY($1::int[])`,
        [jogadorIds]
      );

      // Criar um mapa de detalhes dos jogadores
      const detalhesMap = jogadoresDetalhes.rows.reduce((acc, jogador) => {
        acc[jogador.id_usuario] = jogador;
        return acc;
      }, {});

      // Adicionar detalhes aos times e reservas
      const timesComDetalhes = timesEquilibrados.times.map((time) =>
        time.map((jogador) => ({
          ...jogador,
          ...detalhesMap[jogador.id_usuario],
        }))
      );

      const reservasComDetalhes = timesEquilibrados.reservas.map((reserva) => ({
        ...reserva,
        ...detalhesMap[reserva.id_usuario],
      }));

      res.status(200).json({
        message: 'Times equilibrados com sucesso.',
        times: timesComDetalhes,
        reservas: reservasComDetalhes,
        rotacoes: timesEquilibrados.rotacoes,
      });
    } catch (error) {
      console.error('Erro ao equilibrar times:', error);
      res.status(500).json({ message: 'Erro interno ao equilibrar times.' });
    }
  }
);


/**
 * Função fictícia para equilibrar jogadores em times.
 * Você deve implementar a lógica real conforme seus requisitos.
 */
const equilibrarJogadores = (jogadores, tamanho_time) => {
  // Implementação fictícia
  const times = [];
  const reservas = [];
  const rotacoes = [];

  // Embaralhar jogadores para distribuição aleatória
  const shuffled = jogadores.sort(() => 0.5 - Math.random());

  for (let i = 0; i < shuffled.length; i += tamanho_time) {
    const time = shuffled.slice(i, i + tamanho_time);
    if (time.length === tamanho_time) {
      times.push(time);
    } else {
      reservas.push(...time);
    }
  }

  return { times, reservas, rotacoes };
};

module.exports = router;
