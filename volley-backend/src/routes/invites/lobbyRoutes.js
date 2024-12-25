/**
 * src/routes/lobbyRoutes.js
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');

router.use(authMiddleware);

/* =============================================================================
   1. CRIAR SALA
   -----------------------------------------------------------------------------
   - Insere uma nova sala ou atualiza uma existente para "aberto".
   - Define o limite de jogadores.
============================================================================= */
router.post('/criar', async (req, res) => {
  try {
    const { nome_jogo, data_jogo, horario_inicio, horario_fim, limite_jogadores, id_usuario } = req.body;

    // Validações
    if (!nome_jogo || !data_jogo || !horario_inicio || !horario_fim || !limite_jogadores || !id_usuario) {
      return res.status(400).json({ message: 'Todos os campos são obrigatórios.' });
    }

    // Inserir novo jogo no banco de dados
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

/* =============================================================================
   2. GERAR LINK DE CONVITE
   -----------------------------------------------------------------------------
   - Gera um UUID (convite_uuid) e um ID numérico exclusivo (id_numerico).
   - Cria o registro na tabela "convites" com status "pendente".
============================================================================= */
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

    // Gera um número de 6 dígitos e checa se não está duplicado
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

    // Insere o convite como "pendente"
    await db.query(
      `INSERT INTO convites (id_jogo, id_usuario, convite_uuid, status, data_envio, id_numerico)
       VALUES ($1, $2, $3, $4, NOW(), $5)`,
      [id_jogo, id_usuario, convite_uuid, 'pendente', idNumerico]
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

/* =============================================================================
   3. ENTRAR NA SALA
   -----------------------------------------------------------------------------
   - Verifica se a sala está aberta.
   - Verifica se o convite existe e está com status "pendente".
   - Se a sala estiver lotada, jogador vai para a fila_jogos (status "na_espera").
   - Senão, jogador entra na sala como "ativo" em participacao_jogos.
   - *Não* marca mais o convite como "usado"; ele permanece "pendente".
============================================================================= */
router.post('/entrar', async (req, res) => {
  const client = await db.getClient();

  try {
    const { convite_uuid, id_numerico, id_usuario } = req.body;

    if ((!convite_uuid && !id_numerico) || !id_usuario) {
      return res
        .status(400)
        .json({ error: 'É necessário convite_uuid ou id_numerico + id_usuario.' });
    }

    await client.query('BEGIN');

    // Verifica se o convite existe e está pendente
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

    // Verifica se a sala está aberta
    if (status_jogo !== 'aberto') {
      await client.query('ROLLBACK');
      return res
        .status(403)
        .json({ error: 'A sala está fechada. Não é possível entrar.' });
    }

    // Verifica quantos jogadores "ativos" já estão
    const ativosCountQuery = await client.query(
      'SELECT COUNT(*) AS total_ativos FROM participacao_jogos WHERE id_jogo = $1 AND status = $2',
      [id_jogo, 'ativo']
    );
    const numJogadoresAtivos = parseInt(ativosCountQuery.rows[0].total_ativos, 10) || 0;

    // Obtém o limite de jogadores
    const jogoQuery = await client.query(
      'SELECT limite_jogadores FROM jogos WHERE id_jogo = $1',
      [id_jogo]
    );
    const limiteJogadores = jogoQuery.rows[0]?.limite_jogadores || 0;

    // Se já estiver lotado, insere na fila
    if (numJogadoresAtivos >= limiteJogadores) {
      // Verifica se o jogador já está na fila
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

      // Calcula a próxima posição na fila
      const posicaoQuery = await client.query(
        'SELECT COUNT(*) + 1 AS posicao FROM fila_jogos WHERE id_jogo = $1',
        [id_jogo]
      );
      const posicao = parseInt(posicaoQuery.rows[0].posicao, 10);

      // Insere na fila com status "na_espera"
      await client.query(
        `INSERT INTO fila_jogos (id_jogo, id_usuario, status, posicao_fila, timestamp)
         VALUES ($1, $2, $3, $4, NOW())`,
        [id_jogo, id_usuario, 'na_espera', posicao]
      );

      await client.query('COMMIT');
      return res.status(200).json({ message: 'Jogador adicionado à lista de espera.' });
    }

    // Caso contrário, insere/atualiza como "ativo" em participacao_jogos
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

/* =============================================================================
   4. LISTAR JOGADORES
   -----------------------------------------------------------------------------
   - Retorna dois arrays: "ativos" (participacao_jogos com status = 'ativo')
     e "espera" (fila_jogos com status = 'na_espera').
   - Retorna isOrganizer, limite_jogadores e status da sala.
============================================================================= */
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

    const { id_usuario: organizador_id, limite_jogadores, status } = jogoQuery.rows[0];
    const isOrganizer =
      parseInt(id_usuario_logado, 10) === parseInt(organizador_id, 10);

    // Busca os jogadores que estão em participacao_jogos como status "ativo"
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

    // Busca os jogadores que estão na fila (fila_jogos) com status "na_espera"
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

    return res.status(200).json({
      ativos,
      espera,
      isOrganizer,
      limite_jogadores,
      status, // Inclui o status da sala
    });
  } catch (error) {
    console.error('Erro ao listar jogadores:', error.message);
    return res.status(500).json({ error: 'Erro ao listar jogadores.' });
  }
});

/* =============================================================================
   5. CONFIRMAR PRESENÇA
   -----------------------------------------------------------------------------
   - Define "confirmado" como TRUE em participacao_jogos.
============================================================================= */
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

/* =============================================================================
   6. CONFIRMAR PAGAMENTO
   -----------------------------------------------------------------------------
   - Define "pago" como TRUE em participacao_jogos.
============================================================================= */
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

    return res.status(200).json({ message: 'Pagamento confirmado com sucesso.' });
  } catch (error) {
    console.error('Erro ao confirmar pagamento:', error.message);
    return res.status(500).json({ error: 'Erro ao confirmar pagamento.' });
  }
});

/* =============================================================================
   7. SAIR DA SALA
   -----------------------------------------------------------------------------
   - Muda o status do jogador para "saiu" em participacao_jogos.
   - Caso haja alguém na fila, promove para "ativo" (se houver vaga).
============================================================================= */
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

    // Atualiza status para "saiu"
    await client.query(
      `UPDATE participacao_jogos
          SET status = 'saiu'
        WHERE id_jogo = $1
          AND id_usuario = $2`,
      [id_jogo, id_usuario]
    );

    // Verifica se há fila
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

      // Verifica o número de ativos
      const ativosCountQuery = await client.query(
        `SELECT COUNT(*) AS total_ativos
           FROM participacao_jogos
          WHERE id_jogo = $1
            AND status = 'ativo'`,
        [id_jogo]
      );
      const numJogadoresAtivos = parseInt(ativosCountQuery.rows[0].total_ativos, 10) || 0;

      // Obtém o limite
      const jogoQuery = await client.query(
        'SELECT limite_jogadores FROM jogos WHERE id_jogo = $1',
        [id_jogo]
      );
      const limiteJogadores = jogoQuery.rows[0]?.limite_jogadores || 0;

      // Se tiver vaga, promove o próximo da fila
      if (numJogadoresAtivos < limiteJogadores) {
        await client.query(
          `INSERT INTO participacao_jogos (id_jogo, id_usuario, status, confirmado, pago)
           VALUES ($1, $2, 'ativo', FALSE, FALSE)
           ON CONFLICT (id_jogo, id_usuario)
           DO UPDATE SET status = 'ativo'`,
          [id_jogo, proximoDaFila]
        );

        // Remove da fila
        await client.query(
          `DELETE FROM fila_jogos
            WHERE id_jogo = $1
              AND id_usuario = $2`,
          [id_jogo, proximoDaFila]
        );
      }
    }

    await client.query('COMMIT');
    return res
      .status(200)
      .json({ message: 'Usuário saiu. Se havia fila, o próximo foi promovido.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao sair da sala:', error.message);
    return res.status(500).json({ error: 'Erro ao sair da sala.' });
  } finally {
    client.release();
  }
});

/* =============================================================================
   8. REMOVER USUÁRIO (SOMENTE ORGANIZADOR)
   -----------------------------------------------------------------------------
   - Organizador pode remover um usuário (status = 'removido').
   - Promove o próximo da fila, se houver espaço.
============================================================================= */
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

    // Verifica se quem remove é o organizador
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

    // Seta status como "removido"
    await client.query(
      `UPDATE participacao_jogos
          SET status = 'removido'
        WHERE id_jogo = $1
          AND id_usuario = $2`,
      [id_jogo, id_usuario_remover]
    );

    // Verifica fila
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

      // Contagem de ativos
      const ativosCountQuery = await client.query(
        `SELECT COUNT(*) AS total_ativos
           FROM participacao_jogos
          WHERE id_jogo = $1
            AND status = 'ativo'`,
        [id_jogo]
      );
      const numJogadoresAtivos = parseInt(ativosCountQuery.rows[0].total_ativos, 10) || 0;

      // Limite
      const jogoQuery = await client.query(
        'SELECT limite_jogadores FROM jogos WHERE id_jogo = $1',
        [id_jogo]
      );
      const limiteJogadores = jogoQuery.rows[0]?.limite_jogadores || 0;

      // Promove se houver espaço
      if (numJogadoresAtivos < limiteJogadores) {
        await client.query(
          `INSERT INTO participacao_jogos (id_jogo, id_usuario, status, confirmado, pago)
           VALUES ($1, $2, 'ativo', FALSE, FALSE)
           ON CONFLICT (id_jogo, id_usuario)
           DO UPDATE SET status = 'ativo'`,
          [id_jogo, proximoDaFila]
        );

        // Remove da fila
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

/* =============================================================================
   9. TOGGLE STATUS SALA
   -----------------------------------------------------------------------------
   - Alterna o status de 'aberto' -> 'fechado' ou 'fechado' -> 'aberto'
   - Mantém o mesmo id_jogo e uuid
   - (Opcional) Expira convites pendentes ao fechar
============================================================================= */
router.post('/toggle-status', async (req, res) => {
  try {
    const { id_jogo, id_usuario_organizador } = req.body;

    if (!id_jogo || !id_usuario_organizador) {
      return res.status(400).json({
        error: 'id_jogo e id_usuario_organizador são obrigatórios.'
      });
    }

    // Verifica se a sala existe e obtém o organizador
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
      return res.status(403).json({ error: 'Somente o organizador pode alterar o status.' });
    }

    // Determina novo status
    const novoStatus = (status === 'aberto') ? 'fechado' : 'aberto';

    // Atualiza o status no banco
    await db.query(
      `UPDATE jogos
          SET status = $1
        WHERE id_jogo = $2`,
      [novoStatus, id_jogo]
    );

    // (Opcional) Se quiser expirar convites pendentes ao fechar, faça:
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
      status: novoStatus
    });
  } catch (error) {
    console.error('Erro ao alterar status da sala:', error.message);
    return res.status(500).json({ error: 'Erro ao alterar status da sala.' });
  }
});

// REMOVA OU COMENTE O ENDPOINT ABAIXO SE NÃO FOR MAIS NECESSÁRIO
// /* =============================================================================
//    10. FECHAR SALA
//    -----------------------------------------------------------------------------
//    - Organizador fecha a sala: status = 'fechado'.
//    - Expira todos os convites pendentes (status = 'expirado').
// ============================================================================= */
// router.post('/fechar-sala', async (req, res) => {
//   // Código antigo do fechar-sala
// });

module.exports = router;
