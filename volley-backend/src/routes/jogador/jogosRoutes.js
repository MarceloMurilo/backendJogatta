const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');
const roleMiddleware = require('../../middlewares/roleMiddleware');

// Middleware simples de log
router.use((req, res, next) => {
  console.log(`=== Nova requisição em /api/jogos ===`);
  console.log(`Método: ${req.method}`);
  console.log(`URL: ${req.originalUrl}`);
  console.log(`Body:`, req.body);
  console.log(`Params:`, req.params);
  console.log(`==============================`);
  next();
});

// Rota para criar um jogo
router.post('/criar', authMiddleware, async (req, res) => {
  const { 
    nome_jogo, 
    data_jogo, 
    horario_inicio, 
    horario_fim, 
    limite_jogadores, 
    id_usuario 
  } = req.body;

  console.log('[INFO] Recebida solicitação para criar jogo:', {
    nome_jogo,
    data_jogo,
    horario_inicio,
    horario_fim,
    limite_jogadores,
    id_usuario,
  });

  if (
    !nome_jogo ||
    !data_jogo ||
    !horario_inicio ||
    !horario_fim ||
    !limite_jogadores ||
    !id_usuario
  ) {
    console.error('[ERROR] Campos obrigatórios ausentes.');
    return res.status(400).json({ message: 'Todos os campos são obrigatórios.' });
  }

  // Valida duração do jogo
  const duracao = new Date(`${data_jogo}T${horario_fim}`) - new Date(`${data_jogo}T${horario_inicio}`);
  if (duracao > 12 * 60 * 60 * 1000) {
    console.error('[ERROR] A duração do jogo excede 12 horas.');
    return res.status(400).json({ message: 'A duração máxima do jogo é 12 horas.' });
  }
  if (duracao <= 0) {
    console.error('[ERROR] O horário de término é anterior ao horário de início.');
    return res
      .status(400)
      .json({ message: 'O horário de término deve ser após o horário de início.' });
  }

  const client = await db.getClient();
  try {
    console.log('[INFO] Iniciando transação para criar jogo.');
    await client.query('BEGIN');

    // Inserção do jogo na tabela 'jogos'
    console.log('[INFO] Inserindo jogo na tabela `jogos`.');
    const result = await client.query(
      `INSERT INTO jogos (nome_jogo, data_jogo, horario_inicio, horario_fim, limite_jogadores, id_usuario, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'aberto')
       RETURNING id_jogo`,
      [nome_jogo, data_jogo, horario_inicio, horario_fim, limite_jogadores, id_usuario]
    );

    const id_jogo = result.rows[0]?.id_jogo;
    if (!id_jogo) {
      throw new Error('Falha ao obter o ID do jogo recém-criado.');
    }
    console.log('[INFO] Jogo criado com ID:', id_jogo);

    // Inserir o organizador na tabela 'participacao_jogos'
    console.log('[INFO] Inserindo participação do organizador na tabela `participacao_jogos`.');
    await client.query(
      `INSERT INTO participacao_jogos (id_jogo, id_usuario, data_participacao, status)
       VALUES ($1, $2, NOW(), 'ativo')`,
      [id_jogo, id_usuario]
    );

    await client.query('COMMIT'); // Finaliza a transação
    console.log('[INFO] Jogo criado com sucesso. Transação concluída.');

    return res
      .status(201)
      .json({ message: 'Jogo criado com sucesso.', id_jogo });
  } catch (error) {
    console.error('[ERROR] Erro ao criar jogo:', error.message);
    await client.query('ROLLBACK'); // Reverte alterações em caso de erro
    return res.status(500).json({ message: 'Erro interno ao criar o jogo.', error: error.message });
  } finally {
    client.release();
    console.log('[INFO] Conexão com o banco de dados liberada.');
  }
});

// Rota para convidar amigos para um jogo
router.post(
  '/convidar',
  authMiddleware,
  roleMiddleware(['organizador']), // Apenas organizadores podem convidar
  async (req, res) => {
    const { id_jogo, amigos_ids } = req.body;

    if (!id_jogo || !Array.isArray(amigos_ids) || amigos_ids.length === 0) {
      return res.status(400).json({ message: 'ID do jogo e uma lista de amigos são obrigatórios.' });
    }

    try {
      const queryText = `
        INSERT INTO participacao_jogos (id_jogo, id_usuario, data_participacao)
        VALUES ${amigos_ids.map((_, idx) => `($1, $${idx + 2}, NOW())`).join(', ')}`;
      const queryValues = [id_jogo, ...amigos_ids];

      await db.query(queryText, queryValues);
      res.status(201).json({ message: 'Amigos convidados com sucesso.' });
    } catch (error) {
      console.error('Erro ao convidar amigos:', error);
      res.status(500).json({ message: 'Erro interno ao convidar amigos.', error });
    }
  }
);

// Rota para buscar habilidades dos jogadores de um jogo
router.get(
  '/:id_jogo/habilidades',
  authMiddleware,
  roleMiddleware(['jogador', 'organizador']), // Ambos podem acessar
  async (req, res) => {
    const { id_jogo } = req.params;

    if (!id_jogo) {
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
        [id_jogo]
      );

      console.log('Resultado da consulta para habilidades:', result.rows);

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Nenhum jogador encontrado para este jogo.' });
      }

      res.status(200).json({ jogadores: result.rows }); // Encapsular dentro de 'jogadores'
    } catch (error) {
      console.error('Erro ao buscar habilidades dos jogadores:', error);
      res.status(500).json({ message: 'Erro interno ao buscar habilidades dos jogadores.', error });
    }
  }
);

// Rota para salvar habilidades dos jogadores de um jogo
router.post(
  '/:id_jogo/habilidades',
  authMiddleware,
  roleMiddleware(['organizador']), // Apenas organizadores podem salvar habilidades
  async (req, res) => {
    const { id_jogo } = req.params;
    const { habilidades } = req.body;

    if (!id_jogo || !Array.isArray(habilidades) || habilidades.length === 0) {
      return res.status(400).json({ message: 'ID do jogo e habilidades dos jogadores são obrigatórios.' });
    }

    try {
      const queries = habilidades.map((jogador) =>
        db.query(
          `INSERT INTO avaliacoes (usuario_id, organizador_id, passe, ataque, levantamento)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (usuario_id, organizador_id) 
           DO UPDATE SET passe = $3, ataque = $4, levantamento = $5`,
          [jogador.id_usuario, req.user.id, jogador.passe, jogador.ataque, jogador.levantamento]
        )
      );

      await Promise.all(queries);
      res.status(200).json({ message: 'Habilidades atualizadas com sucesso.' });
    } catch (error) {
      console.error('Erro ao salvar habilidades:', error);
      res.status(500).json({ message: 'Erro interno ao salvar habilidades.', error });
    }
  }
);

module.exports = router;
