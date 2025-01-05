// src/routes/lobbyRoutes.js

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');

// Substitua "backendjogatta.onrender.com" pela sua URL do Render
const BASE_URL = 'https://backendjogatta.onrender.com';

// Aplica o middleware de autenticação a todas as rotas deste router
router.use(authMiddleware);

/**
 * Função para gerar um id_numerico único
 * Gera um número de 6 dígitos e verifica sua unicidade no banco de dados
 */
const generateUniqueIdNumerico = async (attempt = 1, maxAttempts = 5) => {
  if (attempt > maxAttempts) {
    console.error(`Falha ao gerar um id_numerico único após ${maxAttempts} tentativas.`);
    throw new Error('Não foi possível gerar um id_numerico único.');
  }

  // Gera um número de 6 dígitos
  const idNumerico = Math.floor(100000 + Math.random() * 900000);

  // Verifica se já existe esse id_numerico no banco
  const existing = await db.query(
    `SELECT 1 FROM convites WHERE id_numerico = $1`,
    [idNumerico]
  );

  if (existing.rowCount === 0) {
    return idNumerico;
  } else {
    // Tenta novamente
    return await generateUniqueIdNumerico(attempt + 1, maxAttempts);
  }
};

/**
 * Rota para gerar link do convite
 * POST /api/lobby/convites/gerar
 * 
 * Body:
 * {
 *   id_jogo: number
 * }
 * 
 * Response:
 * {
 *   message: "Convite gerado com sucesso.",
 *   convite: {
 *     link: string,
 *     convite_uuid: string,
 *     id_numerico: number
 *   }
 * }
 */
router.post('/convites/gerar', async (req, res) => {
  try {
    const { id_jogo } = req.body;
    const id_usuario = req.user.id;

    if (!id_jogo) {
      return res.status(400).json({ error: 'id_jogo é obrigatório.' });
    }

    // Validação adicional: Verificar se o jogo existe
    const jogoExiste = await db.query(
      'SELECT 1 FROM jogos WHERE id_jogo = $1',
      [id_jogo]
    );

    if (jogoExiste.rowCount === 0) {
      return res.status(404).json({ error: 'Jogo não encontrado.' });
    }

    // Verifica se o usuário é participante ativo do jogo
    const participacaoQuery = await db.query(
      `SELECT status FROM participacao_jogos
       WHERE id_jogo = $1 AND id_usuario = $2`,
      [id_jogo, id_usuario]
    );

    if (participacaoQuery.rowCount === 0 || participacaoQuery.rows[0].status !== 'ativo') {
      return res.status(403).json({ error: 'Somente participantes ativos podem gerar convites.' });
    }

    // Gerar convite_uuid único
    const convite_uuid = uuidv4();

    // Gerar link baseado no convite_uuid e na URL do Render
    const link = `${BASE_URL}/invite/${convite_uuid}`;

    // Gerar id_numerico único
    const id_numerico = await generateUniqueIdNumerico();

    // Inserir o convite no banco de dados com id_numerico
    await db.query(
      `INSERT INTO convites (id_jogo, id_usuario, convite_uuid, status, data_envio, id_numerico)
       VALUES ($1, $2, $3, 'aberto', NOW(), $4)`,
      [id_jogo, id_usuario, convite_uuid, id_numerico]
    );

    return res.status(201).json({
      message: 'Convite gerado com sucesso.',
      convite: { link, convite_uuid, id_numerico },
    });
  } catch (error) {
    console.error('Erro ao gerar convite:', error.message);
    return res.status(500).json({
      message: 'Erro ao gerar o convite.',
      details: error.message,
    });
  }
});

/**
 * Rota para entrar na sala usando convite_uuid ou id_numerico
 * POST /api/lobby/entrar
 * 
 * Body:
 * {
 *   convite_uuid?: string,
 *   id_numerico?: number,
 *   id_usuario: number
 * }
 * 
 * Response:
 * {
 *   message: string
 * }
 */
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

    let id_jogo;
    let status_jogo;

    if (convite_uuid || id_numerico) {
      const query = convite_uuid
        ? `SELECT c.id_jogo, j.status AS status_jogo
             FROM convites c
             JOIN jogos j ON c.id_jogo = j.id_jogo
            WHERE c.convite_uuid = $1 AND c.status = 'aberto'
            LIMIT 1`
        : `SELECT id_jogo, status AS status_jogo
             FROM jogos
            WHERE id_numerico = $1 AND status IN ('aberto', 'balanceando times')
            LIMIT 1`;

      const param = convite_uuid || id_numerico;

      const jogoQuery = await client.query(query, [param]);
      if (jogoQuery.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: convite_uuid
            ? 'Convite inválido ou expirado.'
            : 'Sala não encontrada ou não disponível para entrada.',
        });
      }

      id_jogo = jogoQuery.rows[0].id_jogo;
      status_jogo = jogoQuery.rows[0].status_jogo;
    }

    // Verificar limite de jogadores ativos
    const ativosCountQuery = await client.query(
      'SELECT COUNT(*) AS total_ativos FROM participacao_jogos WHERE id_jogo = $1 AND status = $2',
      [id_jogo, 'ativo']
    );
    const numJogadoresAtivos = parseInt(ativosCountQuery.rows[0].total_ativos, 10) || 0;

    const jogoQueryDetalhes = await client.query(
      'SELECT limite_jogadores FROM jogos WHERE id_jogo = $1',
      [id_jogo]
    );
    const limiteJogadores = jogoQueryDetalhes.rows[0]?.limite_jogadores || 0;

    if (numJogadoresAtivos >= limiteJogadores) {
      // Verificar se já está na fila
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

      // Adicionar à fila
      const posicaoQuery = await client.query(
        'SELECT COUNT(*) + 1 AS posicao FROM fila_jogos WHERE id_jogo = $1',
        [id_jogo]
      );
      const posicao = parseInt(posicaoQuery.rows[0].posicao, 10);

      await client.query(
        `INSERT INTO fila_jogos (id_jogo, id_usuario, status, posicao_fila, timestamp)
         VALUES ($1, $2, 'na_espera', $3, NOW())`,
        [id_jogo, id_usuario, posicao]
      );

      await client.query('COMMIT');
      return res.status(200).json({ message: 'Jogador adicionado à lista de espera.' });
    }

    // Adicionar como participante ativo
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
    if (client) client.release();
  }
});

/**
 * Rota para listar jogadores do lobby
 * GET /api/lobby/:id_jogo/jogadores
 * 
 * Response:
 * {
 *   jogadores: [
 *     {
 *       id_usuario: number,
 *       nome: string,
 *       status: string,
 *       confirmado: boolean,
 *       pago: boolean
 *     },
 *     // ... outros jogadores
 *   ]
 * }
 */
router.get('/:id_jogo/jogadores', async (req, res) => {
  const { id_jogo } = req.params;

  if (!id_jogo) {
    return res.status(400).json({ error: 'ID do jogo é obrigatório.' });
  }

  try {
    // Busca os jogadores que estão participando do jogo
    const jogadoresQuery = await db.query(
      `SELECT pj.id_usuario, u.nome, pj.status, 
              COALESCE(pj.confirmado, false) AS confirmado,
              COALESCE(pj.pago, false) AS pago
         FROM participacao_jogos pj
         JOIN usuario u ON pj.id_usuario = u.id_usuario
         WHERE pj.id_jogo = $1
         ORDER BY u.nome ASC`,
      [id_jogo]
    );

    const jogadores = jogadoresQuery.rows;

    return res.status(200).json({ jogadores });
  } catch (error) {
    console.error('Erro ao carregar jogadores do lobby:', error.message);
    return res.status(500).json({ error: 'Erro ao carregar jogadores.' });
  }
});

/**
 * Rota para confirmar presença
 * POST /api/lobby/confirmar-presenca
 * 
 * Body:
 * {
 *   id_jogo: number,
 *   id_usuario: number
 * }
 * 
 * Response:
 * {
 *   message: "Presença confirmada com sucesso."
 * }
 */
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

/**
 * Rota para confirmar pagamento
 * POST /api/lobby/confirmar-pagamento
 * 
 * Body:
 * {
 *   id_jogo: number,
 *   id_usuario: number
 * }
 * 
 * Response:
 * {
 *   message: "Pagamento confirmado com sucesso."
 * }
 */
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

/**
 * Rota para sair do lobby
 * POST /api/lobby/sair
 * 
 * Body:
 * {
 *   id_jogo: number,
 *   id_usuario: number
 * }
 * 
 * Response:
 * {
 *   message: string
 * }
 */
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
    if (client) client.release();
  }
});

/**
 * Rota para remover usuário (apenas organizador)
 * POST /api/lobby/remover
 * 
 * Body:
 * {
 *   id_jogo: number,
 *   id_usuario_remover: number,
 *   id_usuario_organizador: number
 * }
 * 
 * Response:
 * {
 *   message: string
 * }
 */
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

    // Verificar se o usuário que está tentando remover é o organizador
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

    // Atualizar o status do usuário para 'removido'
    await client.query(
      `UPDATE participacao_jogos
          SET status = 'removido'
        WHERE id_jogo = $1
          AND id_usuario = $2`,
      [id_jogo, id_usuario_remover]
    );

    // Verificar se há alguém na fila para promover
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
    if (client) client.release();
  }
});

/**
 * Rota para alternar status da sala (aberto/privado)
 * POST /api/lobby/toggle-status
 * 
 * Body:
 * {
 *   id_jogo: number,
 *   id_usuario_organizador: number
 * }
 * 
 * Response:
 * {
 *   message: string,
 *   status: string
 * }
 */
router.post('/toggle-status', async (req, res) => {
  try {
    const { id_jogo, id_usuario_organizador } = req.body;

    if (!id_jogo || !id_usuario_organizador) {
      return res.status(400).json({
        error: 'id_jogo e id_usuario_organizador são obrigatórios.',
      });
    }

    // Verificar se o usuário que está tentando alterar o status é o organizador
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

    // Alternar o status
    const novoStatus = status === 'aberto' ? 'finalizado' : 'aberto';

    await db.query(
      `UPDATE jogos
          SET status = $1
        WHERE id_jogo = $2`,
      [novoStatus, id_jogo]
    );

    // Se a sala for finalizada, atualizar convites para 'expirado'
    if (novoStatus === 'finalizado') {
      await db.query(
        `UPDATE convites
            SET status = 'expirado'
          WHERE id_jogo = $1
            AND status = 'aberto'`,
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

/**
 * Rota para fechar a sala
 * POST /api/lobby/fechar-sala
 * 
 * Body:
 * {
 *   id_jogo: number,
 *   id_usuario_organizador: number
 * }
 * 
 * Response:
 * {
 *   message: string,
 *   status: string
 * }
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

    // Atualizar o status do jogo para 'finalizado'
    await db.query(
      'UPDATE jogos SET status = $1 WHERE id_jogo = $2',
      ['finalizado', id_jogo]
    );

    return res.status(200).json({ message: 'Sala fechada com sucesso.', status: 'finalizado' });
  } catch (error) {
    console.error('Erro ao fechar a sala:', error.message);
    return res.status(500).json({ error: 'Erro ao fechar a sala.' });
  }
});

/**
 * Rota para estender o tempo da sala
 * POST /api/lobby/estender-tempo
 * 
 * Body:
 * {
 *   id_jogo: number,
 *   id_usuario_organizador: number,
 *   novo_termino: string (ISO 8601 format)
 * }
 * 
 * Response:
 * {
 *   message: string
 * }
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

/**
 * Rota para obter salas ativas do usuário
 * GET /api/lobby/me
 * 
 * Response:
 * {
 *   salas: [
 *     {
 *       id_jogo: number,
 *       nome_jogo: string,
 *       data_jogo: string (YYYY-MM-DD),
 *       horario_inicio: string (HH:MM:SS),
 *       horario_fim: string (HH:MM:SS),
 *       status: string,
 *       participacao_status: string
 *     },
 *     // ... outras salas
 *   ]
 * }
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
  AND p.status = 'ativo'  -- Participação ativa
  AND j.status IN ('aberto', 'balanceando times', 'finalizado')  -- Status do jogo
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

/**
 * Rota para visualizar convite via link
 * GET /api/lobby/invite/:uuid
 * 
 * Esta rota exibe informações sobre o convite quando o link é acessado.
 * 
 * Exemplo de Acesso:
 * https://backendjogatta.onrender.com/invite/9e3534e6-a20a-4ef2-a2cd-1005c8bb06df
 * 
 * Response:
 * HTML simples com detalhes do convite
 */
router.get('/invite/:uuid', async (req, res) => {
  const { uuid } = req.params;

  try {
    // Busca o convite no banco
    const conviteQuery = await db.query(
      `SELECT c.id_jogo, j.nome_jogo, u.nome AS organizador, c.status
         FROM convites c
         JOIN jogos j ON c.id_jogo = j.id_jogo
         JOIN usuario u ON j.id_usuario = u.id_usuario
        WHERE c.convite_uuid = $1`,
      [uuid]
    );

    if (conviteQuery.rowCount === 0) {
      return res.status(404).send('Convite inválido ou expirado.');
    }

    const convite = conviteQuery.rows[0];

    // Retorna um HTML simples para teste
    return res.send(`
      <html>
        <head>
          <title>Convite para o Jogo</title>
          <style>
            body { font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px; }
            .container { background-color: #fff; padding: 20px; border-radius: 8px; max-width: 600px; margin: auto; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
            h1 { color: #333; }
            p { color: #555; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Convite para o Jogo: ${convite.nome_jogo}</h1>
            <p><strong>Organizador:</strong> ${convite.organizador}</p>
            <p><strong>Status:</strong> ${convite.status}</p>
            <p>Para aceitar o convite, faça login no aplicativo e entre na sala utilizando o convite gerado.</p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Erro ao buscar convite:', error.message);
    return res.status(500).send('Erro ao processar a solicitação.');
  }
});

module.exports = router;
