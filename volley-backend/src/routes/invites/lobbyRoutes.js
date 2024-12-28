// src/routes/lobbyRoutes.js

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');

router.use(authMiddleware);

// 1. CRIAR SALA
router.post('/criar', async (req, res) => {
  try {
    const {
      nome_jogo,
      data_jogo,
      horario_inicio,
      horario_fim,
      limite_jogadores,
      id_usuario,
    } = req.body;

    if (
      !nome_jogo ||
      !data_jogo ||
      !horario_inicio ||
      !horario_fim ||
      !limite_jogadores ||
      !id_usuario
    ) {
      return res.status(400).json({ message: 'Todos os campos são obrigatórios.' });
    }

    const result = await db.query(
      `INSERT INTO jogos (nome, data_jogo, horario_inicio, horario_fim, limite_jogadores, id_usuario, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id_jogo`,
      [nome_jogo, data_jogo, horario_inicio, horario_fim, limite_jogadores, id_usuario, 'aberto']
    );

    if (result.rowCount === 0) {
      return res.status(500).json({ message: 'Erro ao criar o jogo.' });
    }

    return res.status(201).json({
      message: 'Jogo criado com sucesso.',
      id_jogo: result.rows[0].id_jogo,
    });
  } catch (error) {
    console.error('Erro ao criar o jogo:', error.message);
    return res.status(500).json({ message: 'Erro ao criar o jogo.' });
  }
});

// 2. GERAR LINK DE CONVITE
router.post('/gerar', async (req, res) => {
  try {
    const { id_jogo, id_usuario } = req.body;

    if (!id_jogo || !id_usuario) {
      return res
        .status(400)
        .json({ error: 'id_jogo e id_usuario são obrigatórios.' });
    }

    const convite_uuid = uuidv4();
    let idNumerico;
    let isUnique = false;

    while (!isUnique) {
      idNumerico = Math.floor(100000 + Math.random() * 900000);
      const existing = await db.query(
        'SELECT 1 FROM convites WHERE id_numerico = $1',
        [idNumerico]
      );
      if (existing.rowCount === 0) {
        isUnique = true;
      }
    }

    await db.query(
      `INSERT INTO convites (id_jogo, id_usuario, convite_uuid, status, data_envio, id_numerico)
       VALUES ($1, $2, $3, $4, NOW(), $5)`,
      [id_jogo, id_usuario, convite_uuid, 'aberto', idNumerico]
    );

    return res.status(201).json({
      convite: {
        link: `https://jogatta.com/invite/${convite_uuid}`,
        id_numerico: idNumerico,
      },
      message: 'Convite criado com sucesso!',
    });
  } catch (error) {
    console.error('Erro ao gerar convite:', error.message);
    return res.status(500).json({ error: 'Erro ao gerar o convite.' });
  }
});

// 3. ENTRAR NA SALA
router.post('/entrar', async (req, res) => {
  const client = await db.getClient();

  try {
    const { convite_uuid, id_numerico, id_usuario } = req.body;

    if ((!convite_uuid && !id_numerico) || !id_usuario) {
      return res.status(400).json({
        error: 'É necessário convite_uuid ou id_numerico + id_usuario.',
      });
    }

    await client.query('BEGIN');

    const conviteQuery = await client.query(
      `SELECT c.id_jogo, j.status AS status_jogo
         FROM convites c
         JOIN jogos j ON c.id_jogo = j.id_jogo
        WHERE (c.convite_uuid = $1 OR c.id_numerico = $2)
          AND c.status = $3
        LIMIT 1`,
      [convite_uuid, id_numerico, 'pendente']
    );

    if (conviteQuery.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Convite inválido ou expirado.' });
    }

    const { id_jogo, status_jogo } = conviteQuery.rows[0];

    if (!['aberto', 'balanceando times'].includes(status_jogo)) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'A sala não está disponível para entrada.',
      });
    }

    const ativosCountQuery = await client.query(
      'SELECT COUNT(*) AS total_ativos FROM participacao_jogos WHERE id_jogo = $1 AND status = $2',
      [id_jogo, 'ativo']
    );
    const numJogadoresAtivos = parseInt(ativosCountQuery.rows[0].total_ativos, 10) || 0;

    const jogoQuery = await client.query(
      'SELECT limite_jogadores FROM jogos WHERE id_jogo = $1',
      [id_jogo]
    );
    const limiteJogadores = jogoQuery.rows[0]?.limite_jogadores || 0;

    if (numJogadoresAtivos >= limiteJogadores) {
      const usuarioFilaQuery = await client.query(
        'SELECT 1 FROM fila_jogos WHERE id_jogo = $1 AND id_usuario = $2',
        [id_jogo, id_usuario]
      );

      if (usuarioFilaQuery.rowCount > 0) {
        await client.query('ROLLBACK');
        return res
          .status(200)
          .json({ message: 'Jogador já está na lista de espera.' });
      }

      const posicaoQuery = await client.query(
        'SELECT COUNT(*) + 1 AS posicao FROM fila_jogos WHERE id_jogo = $1',
        [id_jogo]
      );
      const posicao = parseInt(posicaoQuery.rows[0].posicao, 10);

      await client.query(
        `INSERT INTO fila_jogos (id_jogo, id_usuario, status, posicao_fila, timestamp)
         VALUES ($1, $2, $3, $4, NOW())`,
        [id_jogo, id_usuario, 'na_espera', posicao]
      );

      await client.query('COMMIT');
      return res.status(200).json({ message: 'Jogador adicionado à lista de espera.' });
    }

    await client.query(
      `INSERT INTO participacao_jogos (id_jogo, id_usuario, status, confirmado, pago)
       VALUES ($1, $2, 'ativo', FALSE, FALSE)
       ON CONFLICT (id_jogo, id_usuario)
       DO UPDATE SET status = 'ativo'`,
      [id_jogo, id_usuario]
    );

    await client.query('COMMIT');
    return res.status(200).json({ message: 'Jogador entrou na sala.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao entrar na sala:', error.message);
    return res.status(500).json({ error: 'Erro ao entrar na sala.' });
  } finally {
    client.release();
  }
});

// 4. LISTAR JOGADORES
router.get('/:id_jogo/jogadores', async (req, res) => {
  try {
    const { id_jogo } = req.params;
    const id_usuario_logado = req.user ? req.user.id : null;

    // Verifica se o jogo existe
    const jogoQuery = await db.query(
      `SELECT id_usuario, limite_jogadores, status
         FROM jogos
        WHERE id_jogo = $1
        LIMIT 1`,
      [id_jogo]
    );

    if (jogoQuery.rowCount === 0) {
      return res.status(404).json({ error: 'Jogo não encontrado.' });
    }

    const { id_usuario: organizador_id, limite_jogadores, status } =
      jogoQuery.rows[0];
    const isOrganizer =
      parseInt(id_usuario_logado, 10) === parseInt(organizador_id, 10);

    // Lista jogadores ativos
    const ativosQuery = await db.query(
      `SELECT u.id_usuario, u.nome, p.status, p.confirmado, p.pago
         FROM participacao_jogos p
         JOIN usuario u ON p.id_usuario = u.id_usuario
        WHERE p.id_jogo = $1
          AND p.status = 'ativo'
        ORDER BY u.nome ASC`,
      [id_jogo]
    );
    const ativos = ativosQuery.rows;

    // Lista jogadores na fila de espera
    const esperaQuery = await db.query(
      `SELECT u.id_usuario, u.nome, f.status, f.posicao_fila
         FROM fila_jogos f
         JOIN usuario u ON f.id_usuario = u.id_usuario
        WHERE f.id_jogo = $1
          AND f.status = 'na_espera'
        ORDER BY f.posicao_fila ASC, u.nome ASC`,
      [id_jogo]
    );
    const espera = esperaQuery.rows;

    // Lista os times e jogadores associados
    const timesQuery = await db.query(
      `SELECT t.numero_time AS time_numero, u.nome AS jogador_nome
         FROM times t
         JOIN usuario u ON t.id_usuario = u.id_usuario
        WHERE t.id_jogo = $1
        ORDER BY t.numero_time, u.nome`,
      [id_jogo]
    );

    // Estrutura os times com seus jogadores
    const times = timesQuery.rows.reduce((acc, row) => {
      const timeExistente = acc.find((t) => t.numero === row.time_numero);
      if (timeExistente) {
        timeExistente.jogadores.push({ nome: row.jogador_nome });
      } else {
        acc.push({
          numero: row.time_numero,
          jogadores: [{ nome: row.jogador_nome }],
        });
      }
      return acc;
    }, []);

    // Retorna todos os dados estruturados
    return res.status(200).json({
      ativos,
      espera,
      isOrganizer,
      limite_jogadores,
      status,
      times, // Inclui os times formados
    });
  } catch (error) {
    console.error('Erro ao listar jogadores:', error.message);
    return res.status(500).json({ error: 'Erro ao listar jogadores.' });
  }
});

// 5. CONFIRMAR PRESENÇA
router.post('/confirmar-presenca', async (req, res) => {
  try {
    const { id_jogo, id_usuario } = req.body;

    if (!id_jogo || !id_usuario) {
      return res
        .status(400)
        .json({ error: 'id_jogo e id_usuario são obrigatórios.' });
    }

    await db.query(
      `UPDATE participacao_jogos
          SET confirmado = TRUE
        WHERE id_jogo = $1
          AND id_usuario = $2`,
      [id_jogo, id_usuario]
    );

    return res.status(200).json({ message: 'Presença confirmada com sucesso.' });
  } catch (error) {
    console.error('Erro ao confirmar presença:', error.message);
    return res.status(500).json({ error: 'Erro ao confirmar presença.' });
  }
});

// 6. CONFIRMAR PAGAMENTO
router.post('/confirmar-pagamento', async (req, res) => {
  try {
    const { id_jogo, id_usuario } = req.body;

    if (!id_jogo || !id_usuario) {
      return res
        .status(400)
        .json({ error: 'id_jogo e id_usuario são obrigatórios.' });
    }

    await db.query(
      `UPDATE participacao_jogos
          SET pago = TRUE
        WHERE id_jogo = $1
          AND id_usuario = $2`,
      [id_jogo, id_usuario]
    );

    return res
      .status(200)
      .json({ message: 'Pagamento confirmado com sucesso.' });
  } catch (error) {
    console.error('Erro ao confirmar pagamento:', error.message);
    return res.status(500).json({ error: 'Erro ao confirmar pagamento.' });
  }
});

// 7. SAIR DA SALA
router.post('/sair', async (req, res) => {
  const client = await db.getClient();

  try {
    const { id_jogo, id_usuario } = req.body;

    if (!id_jogo || !id_usuario) {
      return res
        .status(400)
        .json({ error: 'id_jogo e id_usuario são obrigatórios.' });
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE participacao_jogos
          SET status = 'saiu'
        WHERE id_jogo = $1
          AND id_usuario = $2`,
      [id_jogo, id_usuario]
    );

    const filaQuery = await client.query(
      `SELECT id_usuario
         FROM fila_jogos
        WHERE id_jogo = $1
          AND status = 'na_espera'
        ORDER BY posicao_fila ASC
        LIMIT 1`,
      [id_jogo]
    );

    if (filaQuery.rowCount > 0) {
      const proximoDaFila = filaQuery.rows[0].id_usuario;

      const ativosCountQuery = await client.query(
        `SELECT COUNT(*) AS total_ativos
           FROM participacao_jogos
          WHERE id_jogo = $1
            AND status = 'ativo'`,
        [id_jogo]
      );
      const numJogadoresAtivos = parseInt(ativosCountQuery.rows[0].total_ativos, 10) || 0;

      const jogoQuery = await client.query(
        'SELECT limite_jogadores FROM jogos WHERE id_jogo = $1',
        [id_jogo]
      );
      const limiteJogadores = jogoQuery.rows[0]?.limite_jogadores || 0;

      if (numJogadoresAtivos < limiteJogadores) {
        await client.query(
          `INSERT INTO participacao_jogos (id_jogo, id_usuario, status, confirmado, pago)
           VALUES ($1, $2, 'ativo', FALSE, FALSE)
           ON CONFLICT (id_jogo, id_usuario)
           DO UPDATE SET status = 'ativo'`,
          [id_jogo, proximoDaFila]
        );

        await client.query(
          `DELETE FROM fila_jogos
            WHERE id_jogo = $1
              AND id_usuario = $2`,
          [id_jogo, proximoDaFila]
        );
      }
    }

    await client.query('COMMIT');
    return res.status(200).json({
      message: 'Usuário saiu. Se havia fila, o próximo foi promovido.',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao sair da sala:', error.message);
    return res.status(500).json({ error: 'Erro ao sair da sala.' });
  } finally {
    client.release();
  }
});

// 8. REMOVER USUÁRIO (ORGANIZADOR)
router.post('/remover', async (req, res) => {
  const client = await db.getClient();

  try {
    const { id_jogo, id_usuario_remover, id_usuario_organizador } = req.body;

    if (!id_jogo || !id_usuario_remover || !id_usuario_organizador) {
      return res.status(400).json({
        error: 'id_jogo, id_usuario_remover e id_usuario_organizador são obrigatórios.',
      });
    }

    await client.query('BEGIN');

    const organizadorQuery = await client.query(
      'SELECT id_usuario FROM jogos WHERE id_jogo = $1',
      [id_jogo]
    );

    if (organizadorQuery.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Jogo não encontrado.' });
    }

    const organizador_id = parseInt(organizadorQuery.rows[0].id_usuario, 10);

    if (organizador_id !== parseInt(id_usuario_organizador, 10)) {
      await client.query('ROLLBACK');
      return res
        .status(403)
        .json({ error: 'Somente o organizador pode remover usuários.' });
    }

    await client.query(
      `UPDATE participacao_jogos
          SET status = 'removido'
        WHERE id_jogo = $1
          AND id_usuario = $2`,
      [id_jogo, id_usuario_remover]
    );

    const filaQuery = await client.query(
      `SELECT id_usuario
         FROM fila_jogos
        WHERE id_jogo = $1
          AND status = 'na_espera'
        ORDER BY posicao_fila ASC
        LIMIT 1`,
      [id_jogo]
    );

    if (filaQuery.rowCount > 0) {
      const proximoDaFila = filaQuery.rows[0].id_usuario;

      const ativosCountQuery = await client.query(
        `SELECT COUNT(*) AS total_ativos
           FROM participacao_jogos
          WHERE id_jogo = $1
            AND status = 'ativo'`,
        [id_jogo]
      );
      const numJogadoresAtivos = parseInt(ativosCountQuery.rows[0].total_ativos, 10) || 0;

      const jogoQuery = await client.query(
        'SELECT limite_jogadores FROM jogos WHERE id_jogo = $1',
        [id_jogo]
      );
      const limiteJogadores = jogoQuery.rows[0]?.limite_jogadores || 0;

      if (numJogadoresAtivos < limiteJogadores) {
        await client.query(
          `INSERT INTO participacao_jogos (id_jogo, id_usuario, status, confirmado, pago)
           VALUES ($1, $2, 'ativo', FALSE, FALSE)
           ON CONFLICT (id_jogo, id_usuario)
           DO UPDATE SET status = 'ativo'`,
          [id_jogo, proximoDaFila]
        );

        await client.query(
          `DELETE FROM fila_jogos
            WHERE id_jogo = $1
              AND id_usuario = $2`,
          [id_jogo, proximoDaFila]
        );
      }
    }

    await client.query('COMMIT');
    return res.status(200).json({ message: 'Usuário removido do lobby.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao remover usuário:', error.message);
    return res.status(500).json({ error: 'Erro ao remover usuário.' });
  } finally {
    client.release();
  }
});

// 9. TOGGLE STATUS SALA
router.post('/toggle-status', async (req, res) => {
  try {
    const { id_jogo, id_usuario_organizador } = req.body;

    if (!id_jogo || !id_usuario_organizador) {
      return res.status(400).json({
        error: 'id_jogo e id_usuario_organizador são obrigatórios.',
      });
    }

    const jogoQuery = await db.query(
      `SELECT id_usuario, status
         FROM jogos
        WHERE id_jogo = $1
        LIMIT 1`,
      [id_jogo]
    );

    if (jogoQuery.rowCount === 0) {
      return res.status(404).json({ error: 'Sala não encontrada.' });
    }

    const { id_usuario: organizador_id, status } = jogoQuery.rows[0];
    if (parseInt(organizador_id, 10) !== parseInt(id_usuario_organizador, 10)) {
      return res
        .status(403)
        .json({ error: 'Somente o organizador pode alterar o status.' });
    }

    const novoStatus = status === 'aberto' ? 'finalizado' : 'aberto';

    await db.query(
      `UPDATE jogos
          SET status = $1
        WHERE id_jogo = $2`,
      [novoStatus, id_jogo]
    );

    if (novoStatus === 'fechado') {
      await db.query(
        `UPDATE convites
            SET status = 'expirado'
          WHERE id_jogo = $1
            AND status = 'pendente'`,
        [id_jogo]
      );
    }

    return res.status(200).json({
      message: `Status da sala atualizado para '${novoStatus}'.`,
      status: novoStatus,
    });
  } catch (error) {
    console.error('Erro ao alterar status da sala:', error.message);
    return res.status(500).json({ error: 'Erro ao alterar status da sala.' });
  }
});

/*
  -------------------------------------------
  10. FECHAR SALA
  -------------------------------------------
  Endpoint para encerrar a sala, atualizando o status para 'fechada'.
*/
router.post('/fechar-sala', async (req, res) => {
  const { id_jogo, id_usuario_organizador } = req.body;

  if (!id_jogo || !id_usuario_organizador) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios ausentes.' });
  }

  try {
    // Verificar se o usuário é organizador
    const organizadorQuery = await db.query(
      'SELECT id_usuario FROM jogos WHERE id_jogo = $1',
      [id_jogo]
    );

    if (organizadorQuery.rowCount === 0) {
      return res.status(404).json({ error: 'Jogo não encontrado.' });
    }

    const organizador_id = organizadorQuery.rows[0].id_usuario;
    if (parseInt(organizador_id) !== parseInt(id_usuario_organizador)) {
      return res.status(403).json({ error: 'Apenas o organizador pode encerrar a sala.' });
    }

    // Atualizar o status do jogo para 'fechada'
    await db.query(
      'UPDATE jogos SET status = $1 WHERE id_jogo = $2',
      ['finalizado', id_jogo]
    );

    return res.status(200).json({ message: 'Sala fechada com sucesso.', status: 'fechada' });
  } catch (error) {
    console.error('Erro ao fechar a sala:', error.message);
    return res.status(500).json({ error: 'Erro ao fechar a sala.' });
  }
});

/*
  -------------------------------------------
  11. ESTENDER TEMPO DA SALA
  -------------------------------------------
  Endpoint para estender o tempo de término da sala.
*/
router.post('/estender-tempo', async (req, res) => {
  const { id_jogo, id_usuario_organizador, novo_termino } = req.body;

  if (!id_jogo || !id_usuario_organizador || !novo_termino) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios ausentes.' });
  }

  try {
    // Verificar se o usuário é organizador
    const organizadorQuery = await db.query(
      'SELECT id_usuario FROM jogos WHERE id_jogo = $1',
      [id_jogo]
    );

    if (organizadorQuery.rowCount === 0) {
      return res.status(404).json({ error: 'Jogo não encontrado.' });
    }

    const organizador_id = organizadorQuery.rows[0].id_usuario;
    if (parseInt(organizador_id) !== parseInt(id_usuario_organizador)) {
      return res.status(403).json({ error: 'Apenas o organizador pode estender o tempo.' });
    }

    // Validar novo término
    const terminoAtualQuery = await db.query(
      'SELECT horario_fim FROM jogos WHERE id_jogo = $1',
      [id_jogo]
    );

    if (terminoAtualQuery.rowCount === 0) {
      return res.status(404).json({ error: 'Jogo não encontrado.' });
    }

    const terminoAtual = terminoAtualQuery.rows[0].horario_fim;
    const novoTerminodata = new Date(novo_termino);
    const terminoAtualDate = new Date(terminoAtual);

    if (novoTerminodata <= terminoAtualDate) {
      return res.status(400).json({ error: 'O novo término deve ser maior que o término atual.' });
    }

    // Atualizar o horário de término
    await db.query(
      'UPDATE jogos SET horario_fim = $1 WHERE id_jogo = $2',
      [novo_termino, id_jogo]
    );

    return res.status(200).json({ message: 'Tempo da sala estendido com sucesso.' });
  } catch (error) {
    console.error('Erro ao estender o tempo da sala:', error.message);
    return res.status(500).json({ error: 'Erro ao processar sua solicitação.' });
  }
});

/*
  -------------------------------------------
  12. OBTÉM SALAS ATIVAS DO USUÁRIO
  -------------------------------------------
  Endpoint para obter todas as salas em que o usuário está participando.
*/
router.get('/me', async (req, res) => {
  const id_usuario = req.user.id;

  try {
    const salasQuery = await db.query(
      `SELECT j.id_jogo,
       j.nome_jogo AS nome_jogo,
       to_char(j.data_jogo, 'YYYY-MM-DD') AS data_jogo,
       to_char(j.horario_inicio, 'HH24:MI:SS') AS horario_inicio,
       to_char(j.horario_fim, 'HH24:MI:SS') AS horario_fim,
       j.status,
       p.status AS participacao_status
  FROM participacao_jogos p
  JOIN jogos j ON p.id_jogo = j.id_jogo
 WHERE p.id_usuario = $1
   AND p.status = 'ativo'
  AND j.status IN ('aberto', 'balanceando times', 'em andamento')
 ORDER BY j.data_jogo, j.horario_inicio;`,
      [id_usuario]
    );

    const salas = salasQuery.rows;

    return res.status(200).json({ salas });
  } catch (error) {
    console.error('Erro ao obter salas do usuário:', error.message);
    return res.status(500).json({ error: 'Erro ao obter salas do usuário.' });
  }
});

module.exports = router;
