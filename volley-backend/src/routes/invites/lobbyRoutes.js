const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../../db'); // Conexão com o banco

// 1. Criar Sala de Vôlei
router.post('/criar-sala', async (req, res) => {
  const { id_jogo, id_usuario, limite_jogadores } = req.body;

  if (!id_jogo || !id_usuario || !limite_jogadores) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios: id_jogo, id_usuario e limite_jogadores' });
  }

  try {
    await db.query(
      'UPDATE jogos SET status = $1 WHERE id_jogo = $2',
      ['aberto', id_jogo]
    );

    res.status(201).json({ message: 'Sala criada com sucesso.', id_jogo, limite_jogadores });
  } catch (error) {
    console.error('Erro ao criar sala:', error.message);
    res.status(500).json({ error: 'Erro ao criar sala.' });
  }
});

// 2. Gerar Link de Convite
router.post('/gerar', async (req, res) => {
  const { id_jogo, id_usuario } = req.body;
  if (!id_jogo || !id_usuario) {
    return res.status(400).json({ error: 'id_jogo e id_usuario são obrigatórios.' });
  }

  const convite_uuid = uuidv4();
  try {
    await db.query(
      `INSERT INTO convites (id_jogo, id_usuario, convite_uuid, status, date_sent)
       VALUES ($1, $2, $3, $4, NOW())`,
      [id_jogo, id_usuario, convite_uuid, 'pendente']
    );
    const link = `https://jogatta.com/invite/${convite_uuid}`;
    res.status(201).json({ convite: link });
  } catch (error) {
    console.error('Erro ao gerar o convite:', error.message);
    res.status(500).json({ error: 'Erro ao gerar o convite.' });
  }
});

// 3. Entrar na Sala
router.post('/entrar', async (req, res) => {
  const { convite_uuid, id_usuario } = req.body;
  if (!convite_uuid || !id_usuario) {
    return res.status(400).json({ error: 'convite_uuid e id_usuario são obrigatórios.' });
  }

  try {
    const convite = await db.query('SELECT id_jogo FROM convites WHERE convite_uuid = $1 AND status = $2', [convite_uuid, 'pendente']);
    if (convite.rowCount === 0) {
      return res.status(404).json({ error: 'Convite inválido ou expirado.' });
    }
    const id_jogo = convite.rows[0].id_jogo;

    const { rowCount: numJogadores } = await db.query(
      'SELECT 1 FROM participacao_jogos WHERE id_jogo = $1 AND status = $2',
      [id_jogo, 'ativo']
    );

    const limite = await db.query('SELECT limite_jogadores FROM jogos WHERE id_jogo = $1', [id_jogo]);
    const limiteJogadores = limite.rows[0]?.limite_jogadores;

    if (numJogadores >= limiteJogadores) {
      // Adiciona o jogador na fila de espera
      const posicao = await db.query('SELECT COUNT(*) + 1 AS posicao FROM fila_jogos WHERE id_jogo = $1', [id_jogo]);
      await db.query(
        'INSERT INTO fila_jogos (id_jogo, id_usuario, status, posicao_fila, timestamp) VALUES ($1, $2, $3, $4, NOW())',
        [id_jogo, id_usuario, 'na_espera', posicao.rows[0].posicao]
      );
      return res.status(200).json({ message: 'Jogador adicionado à lista de espera.' });
    }

    // Adiciona o jogador ao jogo
    await db.query(
      `INSERT INTO participacao_jogos (id_jogo, id_usuario, status)
       VALUES ($1, $2, 'ativo')
       ON CONFLICT (id_jogo, id_usuario) DO UPDATE SET status = 'ativo'`,
      [id_jogo, id_usuario]
    );

    res.status(200).send('Jogador entrou na sala.');
  } catch (error) {
    console.error('Erro ao entrar na sala:', error.message);
    res.status(500).json({ error: 'Erro ao entrar na sala.' });
  }
});

// 4. Listar Jogadores
router.get('/:id_jogo/jogadores', async (req, res) => {
  const { id_jogo } = req.params;
  try {
    const jogadores = await db.query(
      `SELECT u.nome, p.status
       FROM participacao_jogos p
       JOIN usuario u ON p.id_usuario = u.id_usuario
       WHERE p.id_jogo = $1`,
      [id_jogo]
    );
    res.status(200).json(jogadores.rows);
  } catch (error) {
    console.error('Erro ao listar jogadores:', error.message);
    res.status(500).json({ error: 'Erro ao listar jogadores.' });
  }
});

// 5. Sair da Sala
router.post('/sair', async (req, res) => {
  const { id_jogo, id_usuario } = req.body;
  if (!id_jogo || !id_usuario) {
    return res.status(400).json({ error: 'id_jogo e id_usuario são obrigatórios.' });
  }

  try {
    await db.query('UPDATE participacao_jogos SET status = $1 WHERE id_jogo = $2 AND id_usuario = $3', ['saiu', id_jogo, id_usuario]);

    // Verifica a lista de espera e move o primeiro jogador para a sala
    const fila = await db.query('SELECT id_usuario FROM fila_jogos WHERE id_jogo = $1 ORDER BY posicao_fila ASC LIMIT 1', [id_jogo]);
    if (fila.rowCount > 0) {
      const usuarioFila = fila.rows[0].id_usuario;
      await db.query(
        `INSERT INTO participacao_jogos (id_jogo, id_usuario, status)
         VALUES ($1, $2, 'ativo')
         ON CONFLICT (id_jogo, id_usuario) DO UPDATE SET status = 'ativo'`,
        [id_jogo, usuarioFila]
      );
      await db.query('DELETE FROM fila_jogos WHERE id_jogo = $1 AND id_usuario = $2', [id_jogo, usuarioFila]);
    }

    res.status(200).send('Usuário saiu da sala e próximo jogador entrou.');
  } catch (error) {
    console.error('Erro ao sair da sala:', error.message);
    res.status(500).json({ error: 'Erro ao sair da sala.' });
  }
});

module.exports = router;
