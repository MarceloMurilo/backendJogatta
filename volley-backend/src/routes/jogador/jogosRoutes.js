// src/routes/jogosRoutes.js

const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');

// Middleware de log
router.use((req, res, next) => {
  console.log(`=== Nova requisição em /api/jogos ===`);
  console.log(`Método: ${req.method}`);
  console.log(`URL: ${req.originalUrl}`);
  console.log(`Body:`, req.body);
  console.log(`Params:`, req.params);
  console.log(`==============================`);
  next();
});

/**
 * GET /api/jogos/:id_jogo/reserva-status
 * Retorna o status da reserva associada ao jogo
 */
router.get('/:id_jogo/reserva-status', async (req, res) => {
  const { id_jogo } = req.params;

  try {
    const result = await db.query(
      `SELECT status
         FROM reservas
         WHERE id_jogo = $1
         ORDER BY id_reserva DESC
         LIMIT 1`,
      [id_jogo]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Reserva não encontrada para este jogo' });
    }

    return res.json({ status: result.rows[0].status });
  } catch (error) {
    console.error('Erro ao buscar status da reserva:', error);
    return res.status(500).json({ error: 'Erro ao buscar status da reserva' });
  }
});

/**
 * [POST] Criar um jogo.
 *  - Campos obrigatórios para o jogo: nome_jogo, limite_jogadores, id_usuario
 *  - Campos opcionais para criar reserva ao mesmo tempo:
 *      id_empresa, id_quadra, data_reserva, reserva_hora_inicio, reserva_hora_fim, status_reserva
 */
router.post('/criar', authMiddleware, async (req, res) => {
  const {
    nome_jogo,
    limite_jogadores,
    id_usuario,
    descricao,
    chave_pix,
    habilitar_notificacao,
    tempo_notificacao,
    status, // status do jogo (ex.: 'aberto', 'fechado' etc.)

    // Campos de reserva (opcionais)
    id_empresa,
    id_quadra,
    data_reserva,
    reserva_hora_inicio,
    reserva_hora_fim,
    status_reserva
  } = req.body;

  // Validação básica dos campos do jogo
  if (!nome_jogo || !limite_jogadores || !id_usuario) {
    return res.status(400).json({
      message: 'Campos obrigatórios do jogo ausentes (nome_jogo, limite_jogadores, id_usuario).'
    });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // 1) Gerar id_numerico único
    let idNumerico;
    let isUnique = false;

    while (!isUnique) {
      idNumerico = Math.floor(100000 + Math.random() * 900000);
      const existing = await client.query('SELECT 1 FROM jogos WHERE id_numerico = $1', [
        idNumerico
      ]);
      if (existing.rowCount === 0) isUnique = true;
    }

    // 2) Inserir jogo na tabela `jogos`
    const jogoResult = await client.query(
      `INSERT INTO jogos (
         nome_jogo,
         limite_jogadores,
         id_usuario,
         descricao,
         chave_pix,
         status,
         id_numerico,
         habilitar_notificacao,
         tempo_notificacao,
         notificado_automatico
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)
       RETURNING id_jogo`,
      [
        nome_jogo,
        limite_jogadores,
        id_usuario,
        descricao || null,
        chave_pix || null,
        status || 'aberto',
        idNumerico,
        habilitar_notificacao ?? false,
        tempo_notificacao ?? 0
      ]
    );

    const newIdJogo = jogoResult.rows[0].id_jogo;
    if (!newIdJogo) {
      throw new Error('Falha ao obter o ID do jogo recém-criado.');
    }

    // 3) Se vieram campos para criar reserva, faz a checagem de conflito e insere na tabela `reservas`
    if (id_empresa && id_quadra && data_reserva && reserva_hora_inicio && reserva_hora_fim) {
      // (A) Checar se o horário está livre
      const conflictCheck = await client.query(
        `SELECT 1
           FROM reservas
          WHERE id_quadra = $1
            AND data_reserva = $2
            AND status NOT IN ('cancelada','rejeitada')
            AND ( (horario_inicio < $4 AND horario_fim > $3) )`,
        [id_quadra, data_reserva, reserva_hora_inicio, reserva_hora_fim]
      );
      if (conflictCheck.rowCount > 0) {
        throw new Error('Horário indisponível para esta quadra.');
      }

      // (B) Valida se a duração não excede 12 horas (opcional)
      const startTime = new Date(`${data_reserva}T${reserva_hora_inicio}`);
      const endTime = new Date(`${data_reserva}T${reserva_hora_fim}`);
      const diffMs = endTime - startTime;
      if (diffMs <= 0) {
        throw new Error('Horário de término deve ser após o horário de início.');
      }
      if (diffMs > 12 * 60 * 60 * 1000) {
        throw new Error('A duração máxima do jogo/reserva é 12 horas.');
      }

      // (C) Inserir na tabela `reservas`
      await client.query(
        `INSERT INTO reservas (
           id_jogo,
           id_empresa,
           id_quadra,
           data_reserva,
           horario_inicio,
           horario_fim,
           status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          newIdJogo,
          id_empresa,
          id_quadra,
          data_reserva,
          reserva_hora_inicio,
          reserva_hora_fim,
          status_reserva || 'pendente'
        ]
      );
    }

    // 4) Inserir convite inicial na tabela `convites`
    await client.query(
      `INSERT INTO convites (id_jogo, id_numerico, status, data_envio, id_usuario)
       VALUES ($1, $2, 'aberto', NOW(), $3)`,
      [newIdJogo, idNumerico, id_usuario]
    );

    // 5) Inserir o organizador em participacao_jogos
    await client.query(
      `INSERT INTO participacao_jogos (id_jogo, id_usuario, lider_time, status)
       VALUES ($1, $2, $3, 'ativo')`,
      [newIdJogo, id_usuario, true]
    );

    // 6) Inserir na tabela `usuario_funcao` (organizador)
    const organizadorFuncao = await client.query(
      `SELECT id_funcao FROM funcao WHERE nome_funcao = 'organizador'`
    );
    if (organizadorFuncao.rowCount === 0) {
      throw new Error('Função "organizador" não encontrada no banco de dados.');
    }
    const idFuncaoOrganizador = organizadorFuncao.rows[0].id_funcao;
    await client.query(
      `INSERT INTO usuario_funcao (id_usuario, id_funcao, id_jogo)
       VALUES ($1, $2, $3)`,
      [id_usuario, idFuncaoOrganizador, newIdJogo]
    );

    // 7) Inserir o organizador na tabela `times` como parte do Time 1
    await client.query(
      `INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
       VALUES ($1, 1, $2, 0, 0)`,
      [newIdJogo, id_usuario]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Jogo criado com sucesso.',
      id_jogo: newIdJogo,
      id_numerico: idNumerico
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[ERROR] Erro ao criar jogo:', error.message);
    return res.status(500).json({
      message: 'Erro interno ao criar o jogo.',
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Rota para iniciar o balanceamento dos times (sem alterações relevantes)
router.post('/iniciar-balanceamento', authMiddleware, async (req, res) => {
  // ... permanece igual ...
});

// Rota para buscar times de um jogo específico (sem alterações relevantes)
router.get('/:id_jogo/times', authMiddleware, async (req, res) => {
  // ... permanece igual ...
});

// Rota para detalhes do jogo
// -> Removemos a leitura de data_jogo, horario_inicio, horario_fim de "jogos",
//    pois essas colunas não existem mais. O resto permanece.
router.get('/:id_jogo/detalhes', authMiddleware, async (req, res) => {
  const { id_jogo } = req.params;

  if (!id_jogo) {
    return res.status(400).json({ message: 'ID do jogo é obrigatório.' });
  }

  try {
    // Note que removemos j.data_jogo, j.horario_inicio, j.horario_fim
    const jogoResult = await db.query(
      `SELECT j.id_jogo,
              j.nome_jogo,
              j.limite_jogadores,
              j.descricao,
              j.chave_pix,
              j.status,
              j.id_numerico,
              (CASE WHEN j.id_usuario = $1 THEN true ELSE false END) AS "isOrganizer"
         FROM jogos j
         WHERE j.id_jogo = $2
         LIMIT 1`,
      [req.user.id, id_jogo]
    );

    if (jogoResult.rows.length === 0) {
      return res.status(404).json({ message: 'Jogo não encontrado.' });
    }

    const jogo = jogoResult.rows[0];

    // Buscar jogadores
    const participacaoResult = await db.query(
      `SELECT pj.id_usuario,
              u.nome,
              pj.status,
              COALESCE(pj.confirmado, false) AS confirmado,
              COALESCE(pj.pago, false) AS pago
         FROM participacao_jogos pj
         JOIN usuario u ON pj.id_usuario = u.id_usuario
         WHERE pj.id_jogo = $1
         ORDER BY u.nome ASC`,
      [id_jogo]
    );
    const ativos = participacaoResult.rows.filter((row) => row.status === 'ativo');
    const espera = participacaoResult.rows.filter((row) => row.status === 'na_espera');

    // Buscar times
    const timesResult = await db.query(
      `SELECT t.id AS id_time,
              t.numero_time,
              t.id_usuario,
              u.nome AS nome_jogador,
              t.total_score,
              t.total_altura
         FROM times t
         LEFT JOIN usuario u ON t.id_usuario = u.id_usuario
        WHERE t.id_jogo = $1
        ORDER BY t.numero_time, u.nome;`,
      [id_jogo]
    );
    const times = timesResult.rows;

    return res.status(200).json({
      id_jogo: jogo.id_jogo,
      nome_jogo: jogo.nome_jogo,
      limite_jogadores: jogo.limite_jogadores,
      descricao: jogo.descricao,
      chave_pix: jogo.chave_pix,
      status: jogo.status,
      id_numerico: jogo.id_numerico,
      isOrganizer: jogo.isOrganizer,
      jogadoresAtivos: ativos,
      jogadoresEspera: espera,
      timesBalanceados: times
    });
  } catch (error) {
    console.error('Erro ao buscar detalhes do jogo:', error.message);
    return res.status(500).json({
      message: 'Erro interno ao buscar detalhes do jogo.',
      error: error.message
    });
  }
});

module.exports = router;
