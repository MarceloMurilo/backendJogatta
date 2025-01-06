// src/routes/jogosRoutes.js

const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');

// Middleware de log
router.use((req, res, next) => {
  console.log('=== Requisição em /api/jogos ===');
  console.log(`Método: ${req.method}`);
  console.log(`URL: ${req.originalUrl}`);
  console.log('Body:', req.body);
  console.log('Params:', req.params);
  console.log('==============================');
  next();
});

/**
 * -----------------------------------
 * POST /api/jogos/criar
 * Criação de jogo com organizador
 * -----------------------------------
 */
router.post('/criar', authMiddleware, async (req, res) => {
  try {
    // ID do usuário autenticado via token
    const idUsuarioAutenticado = req.user.id; 

    // Dados do corpo
    const {
      nome_jogo,
      data_jogo,
      horario_inicio,
      horario_fim,
      limite_jogadores,
      descricao,
      chave_pix
    } = req.body;

    // Validar obrigatórios
    if (!nome_jogo || !data_jogo || !horario_inicio || !horario_fim || !limite_jogadores) {
      return res.status(400).json({ 
        message: 'Campos obrigatórios ausentes: nome_jogo, data_jogo, horario_inicio, horario_fim, limite_jogadores' 
      });
    }

    // Validar duração
    const duracao = new Date(`${data_jogo}T${horario_fim}`) - new Date(`${data_jogo}T${horario_inicio}`);
    if (duracao > 12 * 60 * 60 * 1000) {
      return res.status(400).json({ message: 'Duração máxima de 12h excedida.' });
    }
    if (duracao <= 0) {
      return res.status(400).json({ message: 'horario_fim deve ser depois de horario_inicio.' });
    }

    // Gerar id_numerico único
    let idNumerico;
    let isUnique = false;

    const client = await db.getClient();
    await client.query('BEGIN');

    while (!isUnique) {
      idNumerico = Math.floor(100000 + Math.random() * 900000);
      const existing = await client.query('SELECT 1 FROM jogos WHERE id_numerico = $1', [idNumerico]);
      if (existing.rowCount === 0) {
        isUnique = true;
      }
    }

    // Inserir jogo na tabela 'jogos', usando id_usuario_organizador
    const insertJogo = await client.query(
      `INSERT INTO jogos (
        nome_jogo, data_jogo, horario_inicio, horario_fim,
        limite_jogadores, id_usuario_organizador,
        descricao, chave_pix, status, id_numerico
      )
      VALUES (
        $1, $2, $3, $4,
        $5, $6,
        $7, $8, 'aberto', $9
      )
      RETURNING id_jogo`,
      [
        nome_jogo,
        data_jogo,
        horario_inicio,
        horario_fim,
        limite_jogadores,
        idUsuarioAutenticado, // este é o organizador
        descricao || null,
        chave_pix || null,
        idNumerico
      ]
    );

    const id_jogo = insertJogo.rows[0]?.id_jogo;
    if (!id_jogo) {
      throw new Error('Falha ao criar jogo (id_jogo não retornado).');
    }

    // Inserir convite (se você quiser)
    await client.query(
      `INSERT INTO convites (id_jogo, id_numerico, status, data_envio, id_usuario)
      VALUES ($1, $2, 'aberto', NOW(), $3)`,
      [id_jogo, idNumerico, idUsuarioAutenticado]
    );

    // Inserir participação do organizador em participacao_jogos
    await client.query(
      `INSERT INTO participacao_jogos (
        id_jogo, id_usuario, lider_time, status
      )
      VALUES ($1, $2, TRUE, 'ativo')`,
      [id_jogo, idUsuarioAutenticado]
    );

    // Se quiser associar organizador a user_funcao
    // Certifique-se de que a funcao "organizador" existe
    // e coloque se for preciso
    /*
    const funcQuery = await client.query(
      `SELECT id_funcao FROM funcao WHERE nome_funcao = 'organizador'`
    );
    if (funcQuery.rowCount > 0) {
      const idFuncOrganizador = funcQuery.rows[0].id_funcao;
      await client.query(
        `INSERT INTO usuario_funcao (id_usuario, id_funcao, id_jogo)
        VALUES ($1, $2, $3)`,
        [idUsuarioAutenticado, idFuncOrganizador, id_jogo]
      );
    }
    */

    await client.query('COMMIT');
    client.release();

    return res.status(201).json({
      message: 'Jogo criado com sucesso.',
      id_jogo,
      id_numerico: idNumerico
    });
  } catch (error) {
    console.error('Erro ao criar jogo:', error);
    return res.status(500).json({
      message: 'Erro interno ao criar jogo.',
      details: error.message
    });
  }
});

/**
 * -----------------------------------
 * GET /api/jogos/:id_jogo/detalhes
 * -----------------------------------
 */
router.get('/:id_jogo/detalhes', authMiddleware, async (req, res) => {
  try {
    const { id_jogo } = req.params;
    const userId = req.user.id; // do token

    if (!id_jogo) {
      return res.status(400).json({ message: 'id_jogo é obrigatório.' });
    }

    // Buscar info do jogo
    const jogoQuery = await db.query(
      `SELECT
        j.id_jogo,
        j.nome_jogo,
        j.data_jogo,
        j.horario_inicio,
        j.horario_fim,
        j.limite_jogadores,
        j.descricao,
        j.chave_pix,
        j.status,
        j.id_numerico,

        -- Check se é organizador
        (CASE WHEN j.id_usuario_organizador = $1 THEN true ELSE false END) AS "isOrganizer"
      FROM jogos j
      WHERE j.id_jogo = $2
      LIMIT 1`,
      [userId, id_jogo]
    );

    if (jogoQuery.rowCount === 0) {
      return res.status(404).json({ message: 'Jogo não encontrado.' });
    }
    const jogo = jogoQuery.rows[0];

    // Carrega participações
    const partQuery = await db.query(
      `SELECT
        pj.id_usuario,
        u.nome,
        pj.status,
        COALESCE(pj.confirmado, false) AS confirmado,
        COALESCE(pj.pago, false)       AS pago
      FROM participacao_jogos pj
      JOIN usuario u ON pj.id_usuario = u.id_usuario
      WHERE pj.id_jogo = $1
      ORDER BY u.nome ASC`,
      [id_jogo]
    );

    // separar
    const jogadoresAtivos = partQuery.rows.filter(r => r.status === 'ativo');
    const jogadoresEspera = partQuery.rows.filter(r => r.status === 'na_espera');

    // Carrega times (se existirem)
    // Precisamos referenciar jogos j no FROM, senão dá "missing FROM-clause entry for table j"
    const timesQuery = await db.query(
      `SELECT
        t.numero_time,
        t.id_usuario,
        t.total_score,
        t.total_altura,
        u2.nome AS nome_jogador,
        -- se tiver avaliacoes
        COALESCE(a.passe, 3) AS passe,
        COALESCE(a.ataque, 3) AS ataque,
        COALESCE(a.levantamento, 3) AS levantamento
      FROM times t
      JOIN usuario u2 ON t.id_usuario = u2.id_usuario
      JOIN jogos j2 ON j2.id_jogo = t.id_jogo  -- alias j2
      LEFT JOIN avaliacoes a
        ON a.usuario_id = u2.id_usuario
       AND a.organizador_id = j2.id_usuario_organizador
      WHERE t.id_jogo = $1
      ORDER BY t.numero_time, u2.nome`,
      [id_jogo]
    );

    // Agrupar times vs reservas
    const mapTimes = {};
    for (const row of timesQuery.rows) {
      const nt = row.numero_time;
      if (!mapTimes[nt]) {
        mapTimes[nt] = {
          nome: `Time ${nt}`,
          jogadores: []
        };
      }
      mapTimes[nt].jogadores.push({
        id_usuario: row.id_usuario,
        nome: row.nome_jogador,
        passe: row.passe,
        ataque: row.ataque,
        levantamento: row.levantamento,
        altura: row.total_altura || 0
      });
    }

    const times = [];
    const reservas = [];
    for (const numeroTime of Object.keys(mapTimes)) {
      if (parseInt(numeroTime, 10) === 99) {
        // reservas
        reservas.push(...mapTimes[numeroTime].jogadores);
      } else {
        times.push({
          nome: mapTimes[numeroTime].nome,
          jogadores: mapTimes[numeroTime].jogadores
        });
      }
    }

    return res.status(200).json({
      id_jogo: jogo.id_jogo,
      nome_jogo: jogo.nome_jogo,
      data_jogo: jogo.data_jogo,
      horario_inicio: jogo.horario_inicio,
      horario_fim: jogo.horario_fim,
      limite_jogadores: jogo.limite_jogadores,
      descricao: jogo.descricao,
      chave_pix: jogo.chave_pix,
      status: jogo.status,
      id_numerico: jogo.id_numerico,

      // Organizador?
      isOrganizer: jogo.isOrganizer, // Corrigido para "isOrganizer"

      // Participações
      jogadoresAtivos,
      jogadoresEspera,

      // Times
      times,
      reservas
    });
  } catch (error) {
    console.error('Erro ao buscar detalhes do jogo:', error);
    return res.status(500).json({
      message: 'Erro interno ao buscar detalhes do jogo.',
      details: error.message
    });
  }
});

module.exports = router;
