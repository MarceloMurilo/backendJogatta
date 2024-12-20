const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../../db');

// Criar sala de vôlei (já existente)
router.post('/criar-sala', async (req, res) => {
  const { id_jogo, id_usuario, limite_jogadores } = req.body;

  if (!id_jogo || !id_usuario || !limite_jogadores || limite_jogadores <= 0) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios: id_jogo, id_usuario e limite_jogadores válidos.' });
  }

  try {
    console.log('Atualizando sala:', { id_jogo, id_usuario, limite_jogadores });
    await db.query(
      'UPDATE jogos SET status = $1, limite_jogadores = $2 WHERE id_jogo = $3',
      ['aberto', limite_jogadores, id_jogo]
    );
    console.log('Sala criada com sucesso:', { id_jogo, limite_jogadores });
    res.status(201).json({ message: 'Sala criada com sucesso.', id_jogo, limite_jogadores });
  } catch (error) {
    console.error('Erro ao criar sala:', error.message);
    res.status(500).json({ error: 'Erro ao criar sala.' });
  }
});

// Gerar Link de Convite (já existente)
router.post('/gerar', async (req, res) => {
  const { id_jogo, id_usuario } = req.body;

  if (!id_jogo || !id_usuario) {
    return res.status(400).json({ error: 'id_jogo e id_usuario são obrigatórios.' });
  }

  const convite_uuid = uuidv4();
  const idNumerico = Math.floor(100000 + Math.random() * 900000);

  try {
    console.log('Gerando convite:', { id_jogo, id_usuario, convite_uuid, idNumerico });
    await db.query(
      `INSERT INTO convites (id_jogo, id_usuario, convite_uuid, status, data_envio, id_numerico)
       VALUES ($1, $2, $3, $4, NOW(), $5)`,
      [id_jogo, id_usuario, convite_uuid, 'pendente', idNumerico]
    );

    console.log('Convite gerado com sucesso:', { idNumerico, convite_uuid });
    res.status(201).json({ convite: { link: `https://jogatta.com/invite/${convite_uuid}`, id_numerico: idNumerico } });
  } catch (error) {
    console.error('Erro ao gerar o convite:', error.message);
    res.status(500).json({ error: 'Erro ao gerar o convite.' });
  }
});

// Entrar na Sala (já existente)
router.post('/entrar', async (req, res) => {
  const { convite_uuid, id_numerico, id_usuario } = req.body;

  if ((!convite_uuid && !id_numerico) || !id_usuario) {
    return res.status(400).json({ error: 'É necessário informar convite_uuid ou id_numerico, além de id_usuario.' });
  }

  try {
    console.log('Verificando convite com UUID ou ID:', { convite_uuid, id_numerico });

    const conviteQuery = `
      SELECT id_jogo
      FROM convites
      WHERE (convite_uuid = $1 OR id_numerico = $2) AND status = $3
    `;
    const convite = await db.query(conviteQuery, [convite_uuid, id_numerico, 'pendente']);

    if (convite.rowCount === 0) {
      console.log('Convite inválido ou expirado:', { convite_uuid, id_numerico });
      return res.status(404).json({ error: 'Convite inválido ou expirado.' });
    }

    const id_jogo = convite.rows[0].id_jogo;
    console.log('Convite válido para o jogo:', id_jogo);

    const { rowCount: numJogadores } = await db.query(
      'SELECT 1 FROM participacao_jogos WHERE id_jogo = $1 AND status = $2',
      [id_jogo, 'ativo']
    );

    const limite = await db.query('SELECT limite_jogadores FROM jogos WHERE id_jogo = $1', [id_jogo]);
    const limiteJogadores = limite.rows[0]?.limite_jogadores;

    console.log(`Número de jogadores ativos: ${numJogadores}, Limite: ${limiteJogadores}`);

    if (numJogadores >= limiteJogadores) {
      const posicao = await db.query('SELECT COUNT(*) + 1 AS posicao FROM fila_jogos WHERE id_jogo = $1', [id_jogo]);
      console.log('Jogador será colocado na fila. Posição:', posicao.rows[0]?.posicao);

      await db.query(
        'INSERT INTO fila_jogos (id_jogo, id_usuario, status, posicao_fila, timestamp) VALUES ($1, $2, $3, $4, NOW())',
        [id_jogo, id_usuario, 'na_espera', posicao.rows[0]?.posicao]
      );
      return res.status(200).json({ message: 'Jogador adicionado à lista de espera.' });
    }

    console.log('Inserindo jogador na sala:', { id_jogo, id_usuario });
    const insertQuery = `
      INSERT INTO participacao_jogos (id_jogo, id_usuario, status, confirmado, pago)
      VALUES ($1, $2, 'ativo', FALSE, FALSE)
      ON CONFLICT (id_jogo, id_usuario) DO UPDATE SET status = 'ativo'
    `;
    console.log('Query de inserção:', insertQuery);
    console.log('Parâmetros:', [id_jogo, id_usuario]);

    const result = await db.query(insertQuery, [id_jogo, id_usuario]);
    console.log('Resultado da inserção:', result);

    res.status(200).send('Jogador entrou na sala.');
  } catch (error) {
    console.error('Erro ao entrar na sala:', error.message);
    res.status(500).json({ error: 'Erro ao entrar na sala.' });
  }
});

// Listar Jogadores
router.get('/:id_jogo/jogadores', async (req, res) => {
  const { id_jogo } = req.params;
  const id_usuario_logado = req.user ? req.user.id : null; // caso não tenha auth

  try {
    console.log('Listando jogadores para o jogo:', id_jogo);

    const organizadorQuery = await db.query(
      'SELECT id_usuario, limite_jogadores FROM jogos WHERE id_jogo = $1',
      [id_jogo]
    );

    if (organizadorQuery.rowCount === 0) {
      console.log('Jogo não encontrado:', id_jogo);
      return res.status(404).json({ error: 'Jogo não encontrado.' });
    }

    const id_organizador = organizadorQuery.rows[0].id_usuario;
    const limite_jogadores = organizadorQuery.rows[0].limite_jogadores;
    const isOrganizer = parseInt(id_usuario_logado, 10) === parseInt(id_organizador, 10);

    console.log('Organizador do jogo:', id_organizador, 'Limite de jogadores:', limite_jogadores);

    const jogadores = await db.query(
      `SELECT u.id_usuario, u.nome, p.status, p.confirmado, p.pago
       FROM participacao_jogos p
       JOIN usuario u ON p.id_usuario = u.id_usuario
       WHERE p.id_jogo = $1`,
      [id_jogo]
    );

    console.log('Jogadores encontrados:', jogadores.rows);

    res.status(200).json({
      jogadores: jogadores.rows,
      isOrganizer,
      limite_jogadores
    });
  } catch (error) {
    console.error('Erro ao listar jogadores:', error.message);
    res.status(500).json({ error: 'Erro ao listar jogadores.' });
  }
});

// Confirmar Presença (já existente)
router.post('/confirmar-presenca', async (req, res) => {
  const { id_jogo, id_usuario } = req.body;
  if (!id_jogo || !id_usuario) {
    return res.status(400).json({ error: 'id_jogo e id_usuario são obrigatórios.' });
  }

  try {
    await db.query(
      'UPDATE participacao_jogos SET confirmado = TRUE WHERE id_jogo = $1 AND id_usuario = $2',
      [id_jogo, id_usuario]
    );
    res.status(200).json({ message: 'Presença confirmada com sucesso.' });
  } catch (error) {
    console.error('Erro ao confirmar presença:', error.message);
    res.status(500).json({ error: 'Erro ao confirmar presença.' });
  }
});

// Confirmar Pagamento (já existente)
router.post('/confirmar-pagamento', async (req, res) => {
  const { id_jogo, id_usuario } = req.body;
  if (!id_jogo || !id_usuario) {
    return res.status(400).json({ error: 'id_jogo e id_usuario são obrigatórios.' });
  }

  try {
    await db.query(
      'UPDATE participacao_jogos SET pago = TRUE WHERE id_jogo = $1 AND id_usuario = $2',
      [id_jogo, id_usuario]
    );
    res.status(200).json({ message: 'Pagamento confirmado com sucesso.' });
  } catch (error) {
    console.error('Erro ao confirmar pagamento:', error.message);
    res.status(500).json({ error: 'Erro ao confirmar pagamento.' });
  }
});

// Sair da Sala (já existente)
router.post('/sair', async (req, res) => {
  const { id_jogo, id_usuario } = req.body;
  if (!id_jogo || !id_usuario) {
    return res.status(400).json({ error: 'id_jogo e id_usuario são obrigatórios.' });
  }

  try {
    await db.query('UPDATE participacao_jogos SET status = $1 WHERE id_jogo = $2 AND id_usuario = $3', ['saiu', id_jogo, id_usuario]);

    const fila = await db.query('SELECT id_usuario FROM fila_jogos WHERE id_jogo = $1 ORDER BY posicao_fila ASC LIMIT 1', [id_jogo]);
    if (fila.rowCount > 0) {
      const usuarioFila = fila.rows[0].id_usuario;
      await db.query(
        `INSERT INTO participacao_jogos (id_jogo, id_usuario, status, confirmado, pago)
         VALUES ($1, $2, 'ativo', FALSE, FALSE)
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
