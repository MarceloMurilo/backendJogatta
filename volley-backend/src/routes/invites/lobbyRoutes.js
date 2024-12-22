// src/routes/lobbyRoutes.js

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');

// Middleware de autenticação (se estiver usando)
router.use(authMiddleware);

/* 
  1. Criar Sala 
  -------------------------------------------------------------------------------------
  - Atualiza o status do jogo para "aberto".
  - Define o limite de jogadores.
*/
router.post('/criar-sala', async (req, res) => {
  try {
    const { id_jogo, id_usuario, limite_jogadores } = req.body;
    if (!id_jogo || !id_usuario || !limite_jogadores || limite_jogadores <= 0) {
      return res.status(400).json({ error: 'Parâmetros obrigatórios inválidos.' });
    }

    await db.query(
      'UPDATE jogos SET status = $1, limite_jogadores = $2 WHERE id_jogo = $3',
      ['aberto', limite_jogadores, id_jogo]
    );

    return res.status(201).json({
      message: 'Sala criada com sucesso.',
      id_jogo,
      limite_jogadores,
    });
  } catch (error) {
    console.error('Erro ao criar sala:', error.message);
    return res.status(500).json({ error: 'Erro ao criar sala.' });
  }
});

/* 
  2. Gerar Link de Convite 
  -------------------------------------------------------------------------------------
  - Gera um convite único (UUID + id_numérico) e insere na tabela "convites".
*/
router.post('/gerar', async (req, res) => {
  try {
    const { id_jogo, id_usuario } = req.body;
    if (!id_jogo || !id_usuario) {
      return res.status(400).json({ error: 'id_jogo e id_usuario são obrigatórios.' });
    }

    const convite_uuid = uuidv4();
    const idNumerico = Math.floor(100000 + Math.random() * 900000);

    await db.query(
      `INSERT INTO convites (id_jogo, id_usuario, convite_uuid, status, data_envio, id_numerico)
       VALUES ($1, $2, $3, $4, NOW(), $5)`,
      [id_jogo, id_usuario, convite_uuid, 'pendente', idNumerico]
    );

    return res.status(201).json({
      convite: {
        link: `https://jogatta.com/invite/${convite_uuid}`,
        id_numerico: idNumerico
      },
      message: 'Convite criado com sucesso!'
    });
  } catch (error) {
    console.error('Erro ao gerar convite:', error.message);
    return res.status(500).json({ error: 'Erro ao gerar o convite.' });
  }
});

/* 
  3. Entrar na Sala 
  -------------------------------------------------------------------------------------
  - Verifica convite (UUID ou id_numerico).
  - Se a sala estiver lotada, jogador vai para "fila_jogos".
  - Senão, jogador entra como "ativo".
  - Convite fica "usado" após a entrada.
*/
router.post('/entrar', async (req, res) => {
  try {
    const { convite_uuid, id_numerico, id_usuario } = req.body;

    if ((!convite_uuid && !id_numerico) || !id_usuario) {
      return res.status(400).json({ error: 'É necessário convite_uuid ou id_numerico + id_usuario.' });
    }

    const convite = await db.query(
      `SELECT id_jogo
       FROM convites
       WHERE (convite_uuid = $1 OR id_numerico = $2) AND status = $3`,
      [convite_uuid, id_numerico, 'pendente']
    );

    if (convite.rowCount === 0) {
      return res.status(404).json({ error: 'Convite inválido ou expirado.' });
    }

    const id_jogo = convite.rows[0].id_jogo;

    // Verifica quantos jogadores "ativos" existem
    const { rowCount: numJogadoresAtivos } = await db.query(
      'SELECT 1 FROM participacao_jogos WHERE id_jogo = $1 AND status = $2',
      [id_jogo, 'ativo']
    );

    const jogo = await db.query('SELECT limite_jogadores FROM jogos WHERE id_jogo = $1', [id_jogo]);
    const limiteJogadores = jogo.rows[0]?.limite_jogadores || 0;

    if (numJogadoresAtivos >= limiteJogadores) {
      // Sala lotada, jogador vai para a fila
      const posicao = await db.query(
        'SELECT COUNT(*) + 1 AS posicao FROM fila_jogos WHERE id_jogo = $1',
        [id_jogo]
      );

      await db.query(
        `INSERT INTO fila_jogos (id_jogo, id_usuario, status, posicao_fila, timestamp)
         VALUES ($1, $2, $3, $4, NOW())`,
        [id_jogo, id_usuario, 'na_espera', posicao.rows[0]?.posicao]
      );

      return res.status(200).json({ message: 'Jogador adicionado à lista de espera.' });
    }

    // Se não estiver lotado, insere como "ativo"
    await db.query(
      `INSERT INTO participacao_jogos (id_jogo, id_usuario, status, confirmado, pago)
       VALUES ($1, $2, 'ativo', FALSE, FALSE)
       ON CONFLICT (id_jogo, id_usuario) DO UPDATE SET status = 'ativo'`,
      [id_jogo, id_usuario]
    );

    // Marca o convite como "usado"
    await db.query(
      `UPDATE convites
       SET status = $1
       WHERE id_jogo = $2
         AND (convite_uuid = $3 OR id_numerico = $4)`,
      ['usado', id_jogo, convite_uuid, id_numerico]
    );

    return res.status(200).json({ message: 'Jogador entrou na sala.' });
  } catch (error) {
    console.error('Erro ao entrar na sala:', error.message);
    return res.status(500).json({ error: 'Erro ao entrar na sala.' });
  }
});

/* 
  4. Listar Jogadores
  -------------------------------------------------------------------------------------
  - Retorna separadamente: "ativos" e "espera".
  - isOrganizer para indicar se o usuário logado é o dono.
*/
router.get('/:id_jogo/jogadores', async (req, res) => {
  try {
    const { id_jogo } = req.params;
    const id_usuario_logado = req.user ? req.user.id : null;

    // 1. Verifica se o jogo existe e obtém o organizador/limite
    const jogoQuery = await db.query(
      'SELECT id_usuario, limite_jogadores FROM jogos WHERE id_jogo = $1',
      [id_jogo]
    );

    if (jogoQuery.rowCount === 0) {
      return res.status(404).json({ error: 'Jogo não encontrado.' });
    }

    const { id_usuario: id_organizador, limite_jogadores } = jogoQuery.rows[0];
    const isOrganizer = parseInt(id_usuario_logado, 10) === parseInt(id_organizador, 10);

    // 2. Consulta os jogadores no participacao_jogos
    const participacoes = await db.query(
      `SELECT u.id_usuario, u.nome, p.status, p.confirmado, p.pago
         FROM participacao_jogos p
         JOIN usuario u ON p.id_usuario = u.id_usuario
        WHERE p.id_jogo = $1`,
      [id_jogo]
    );

    // 3. Separa por status
    const ativos = participacoes.rows.filter((j) => j.status === 'ativo');
    const espera = participacoes.rows.filter((j) => j.status === 'na_espera');

    return res.status(200).json({
      ativos,
      espera,
      isOrganizer,
      limite_jogadores,
    });
  } catch (error) {
    console.error('Erro ao listar jogadores:', error.message);
    return res.status(500).json({ error: 'Erro ao listar jogadores.' });
  }
});

/* 
  5. Confirmar Presença
  -------------------------------------------------------------------------------------
  - Define "confirmado" como TRUE no participacao_jogos.
*/
router.post('/confirmar-presenca', async (req, res) => {
  try {
    const { id_jogo, id_usuario } = req.body;
    if (!id_jogo || !id_usuario) {
      return res.status(400).json({ error: 'id_jogo e id_usuario são obrigatórios.' });
    }

    await db.query(
      'UPDATE participacao_jogos SET confirmado = TRUE WHERE id_jogo = $1 AND id_usuario = $2',
      [id_jogo, id_usuario]
    );
    return res.status(200).json({ message: 'Presença confirmada com sucesso.' });
  } catch (error) {
    console.error('Erro ao confirmar presença:', error.message);
    return res.status(500).json({ error: 'Erro ao confirmar presença.' });
  }
});

/* 
  6. Confirmar Pagamento
  -------------------------------------------------------------------------------------
  - Define "pago" como TRUE no participacao_jogos.
*/
router.post('/confirmar-pagamento', async (req, res) => {
  try {
    const { id_jogo, id_usuario } = req.body;
    if (!id_jogo || !id_usuario) {
      return res.status(400).json({ error: 'id_jogo e id_usuario são obrigatórios.' });
    }

    await db.query(
      'UPDATE participacao_jogos SET pago = TRUE WHERE id_jogo = $1 AND id_usuario = $2',
      [id_jogo, id_usuario]
    );
    return res.status(200).json({ message: 'Pagamento confirmado com sucesso.' });
  } catch (error) {
    console.error('Erro ao confirmar pagamento:', error.message);
    return res.status(500).json({ error: 'Erro ao confirmar pagamento.' });
  }
});

/* 
  7. Sair da Sala
  -------------------------------------------------------------------------------------
  - Atualiza status do jogador para 'saiu'.
  - Move próximo jogador da fila para 'ativo', se houver.
*/
router.post('/sair', async (req, res) => {
  try {
    const { id_jogo, id_usuario } = req.body;
    if (!id_jogo || !id_usuario) {
      return res.status(400).json({ error: 'id_jogo e id_usuario são obrigatórios.' });
    }

    await db.query(
      'UPDATE participacao_jogos SET status = $1 WHERE id_jogo = $2 AND id_usuario = $3',
      ['saiu', id_jogo, id_usuario]
    );

    // Verifica se há alguém na fila
    const fila = await db.query(
      'SELECT id_usuario FROM fila_jogos WHERE id_jogo = $1 ORDER BY posicao_fila ASC LIMIT 1',
      [id_jogo]
    );
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

    return res.status(200).json({ message: 'Usuário saiu e, se havia fila, o próximo entrou.' });
  } catch (error) {
    console.error('Erro ao sair da sala:', error.message);
    return res.status(500).json({ error: 'Erro ao sair da sala.' });
  }
});

/* 
  8. Remover Usuário (Somente Organizador)
  -------------------------------------------------------------------------------------
  - Organizador pode remover um usuário, definindo status = 'removido'.
*/
router.post('/remover', async (req, res) => {
  try {
    const { id_jogo, id_usuario_remover, id_usuario_organizador } = req.body;
    if (!id_jogo || !id_usuario_remover || !id_usuario_organizador) {
      return res
        .status(400)
        .json({ error: 'id_jogo, id_usuario_remover e id_usuario_organizador são obrigatórios.' });
    }

    // Verifica se quem remove é o organizador
    const organizador = await db.query(
      'SELECT id_usuario FROM jogos WHERE id_jogo = $1',
      [id_jogo]
    );

    if (organizador.rowCount === 0) {
      return res.status(404).json({ error: 'Jogo não encontrado.' });
    }

    if (parseInt(organizador.rows[0].id_usuario, 10) !== parseInt(id_usuario_organizador, 10)) {
      return res.status(403).json({ error: 'Somente o organizador pode remover usuários.' });
    }

    await db.query(
      'UPDATE participacao_jogos SET status = $1 WHERE id_jogo = $2 AND id_usuario = $3',
      ['removido', id_jogo, id_usuario_remover]
    );

    return res.status(200).json({ message: 'Usuário removido do lobby.' });
  } catch (error) {
    console.error('Erro ao remover usuário:', error.message);
    return res.status(500).json({ error: 'Erro ao remover usuário.' });
  }
});

module.exports = router;
