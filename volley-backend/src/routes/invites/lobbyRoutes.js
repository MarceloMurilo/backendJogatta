// src/routes/lobbyRoutes.js

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');
const roleMiddleware = require('../../middlewares/roleMiddleware'); // Adicione se necessário

router.use(authMiddleware);

// 1. CRIAR SALA
router.post('/criar', async (req, res) => {
  const client = await db.getClient();

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

    // Valida duração do jogo
    const duracao = new Date(horario_fim) - new Date(horario_inicio);
    if (duracao > 12 * 60 * 60 * 1000) {
      return res.status(400).json({ message: 'A duração máxima do jogo é 12 horas.' });
    }
    if (duracao <= 0) {
      return res.status(400).json({ message: 'O horário de término deve ser após o horário de início.' });
    }

    await client.query('BEGIN');

    // Inserção do jogo na tabela 'jogos'
    const result = await client.query(
      `INSERT INTO jogos (nome, data_jogo, horario_inicio, horario_fim, limite_jogadores, id_usuario, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id_jogo`,
      [nome_jogo, data_jogo, horario_inicio, horario_fim, limite_jogadores, id_usuario, 'aberto']
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({ message: 'Erro ao criar o jogo.' });
    }

    const id_jogo = result.rows[0].id_jogo; // Captura o ID do jogo criado

    // Atribuição do papel de organizador na tabela 'usuario_funcao'
    await client.query(
      `INSERT INTO usuario_funcao (id_usuario, id_jogo, id_funcao, expira_em)
       VALUES ($1, $2, 
         (SELECT id_funcao FROM funcao WHERE nome_funcao = 'organizador'), 
         NULL)`,
      [id_usuario, id_jogo]
    );

    // Inserir o organizador na tabela 'participacao_jogos'
    await client.query(
      `INSERT INTO participacao_jogos (id_jogo, id_usuario, data_participacao, status)
       VALUES ($1, $2, NOW(), 'ativo')`,
      [id_jogo, id_usuario]
    );

    await client.query('COMMIT'); // Finaliza a transação

    return res.status(201).json({
      message: 'Jogo criado com sucesso.',
      id_jogo: id_jogo,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao criar o jogo:', error.message);
    return res.status(500).json({ message: 'Erro ao criar o jogo.', error });
  } finally {
    client.release();
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

    if (status_jogo !== 'aberto') {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'A sala está fechada. Não é possível entrar.',
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
    const isOrganizer = parseInt(id_usuario_logado, 10) === parseInt(organizador_id, 10);

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

    console.log('Jogadores ativos:', ativos);
    console.log('Jogadores na fila:', espera);

    return res.status(200).json({
      jogadores: ativos, // Encapsular ativos como 'jogadores'
      espera,
      isOrganizer,
      limite_jogadores,
      status,
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

    const novoStatus = status === 'aberto' ? 'fechado' : 'aberto';

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

// 10. Rota para Iniciar Balanceamento (exemplo)
router.post('/iniciar-balanceamento', async (req, res) => {
  const client = await db.getClient();

  try {
    const { id_jogo, id_usuario_organizador } = req.body;

    if (!id_jogo || !id_usuario_organizador) {
      return res.status(400).json({ error: 'id_jogo e id_usuario_organizador são obrigatórios.' });
    }

    await client.query('BEGIN');

    // Verificar se o organizador está no jogo
    const organizadorQuery = await client.query(
      `SELECT 1 FROM participacao_jogos 
       WHERE id_jogo = $1 AND id_usuario = $2 AND status = 'ativo'`,
      [id_jogo, id_usuario_organizador]
    );

    if (organizadorQuery.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Organizador não está ativo no jogo.' });
    }

    // Atualizar o status do jogo para 'equilibrando'
    await client.query(
      `UPDATE jogos SET status = 'equilibrando' WHERE id_jogo = $1`,
      [id_jogo]
    );

    // Recuperar os jogadores ativos, incluindo o organizador
    const jogadoresResult = await client.query(
      `SELECT u.id_usuario, u.nome, p.status, p.confirmado, p.pago
         FROM participacao_jogos p
         JOIN usuario u ON p.id_usuario = u.id_usuario
        WHERE p.id_jogo = $1 AND p.status = 'ativo'
        ORDER BY u.nome ASC`,
      [id_jogo]
    );

    console.log('Jogadores após iniciar balanceamento:', jogadoresResult.rows);

    // Implementar a lógica de balanceamento aqui ou no frontend

    await client.query('COMMIT');

    // Supondo que o balanceamento é feito no backend e retornamos os times
    // Aqui está um exemplo simples de balanceamento alternado
    const jogadores = jogadoresResult.rows;
    const times = [[], []];

    jogadores.sort((a, b) => (b.confirmado ? 1 : 0) - (a.confirmado ? 1 : 0)); // Exemplo de ordenação

    jogadores.forEach((jogador, index) => {
      const teamIndex = index % times.length;
      times[teamIndex].push(jogador);
    });

    return res.status(200).json({ message: 'Balanceamento iniciado.', times });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao iniciar balanceamento:', error.message);
    return res.status(500).json({ error: 'Erro ao iniciar balanceamento.' });
  } finally {
    client.release();
  }
});

module.exports = router;
