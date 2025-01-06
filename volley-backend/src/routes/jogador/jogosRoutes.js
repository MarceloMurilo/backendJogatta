// src/routes/jogador/jogosRoutes.js

const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');

// Middleware simples de log
router.use((req, res, next) => {
  console.log(`=== Nova requisição em /api/jogos ===`);
  console.log(`Método: ${req.method}`);
  console.log(`URL: ${req.originalUrl}`);
  console.log(`Body:`, req.body);
  console.log(`Params:`, req.params);
  console.log(`Usuário Autenticado: ${req.user ? req.user.id : 'Não autenticado'}`);
  console.log(`==============================`);
  next();
});

/**
 * ------------------------------------------------
 * POST /api/jogos/criar
 * Criação de um novo jogo
 * ------------------------------------------------
 */
router.post('/criar', authMiddleware, async (req, res) => {
  const {
    nome_jogo,
    data_jogo,
    horario_inicio,
    horario_fim,
    limite_jogadores,
    descricao,
    chave_pix
  } = req.body;

  const id_usuario = req.user.id; // Obtém o ID do usuário autenticado

  console.log('[INFO] Recebida solicitação para criar jogo:', {
    nome_jogo,
    data_jogo,
    horario_inicio,
    horario_fim,
    limite_jogadores,
    descricao,
    chave_pix,
    id_usuario
  });

  // Verifica campos obrigatórios
  if (
    !nome_jogo ||
    !data_jogo ||
    !horario_inicio ||
    !horario_fim ||
    !limite_jogadores
  ) {
    console.error('[ERROR] Campos obrigatórios ausentes.');
    return res
      .status(400)
      .json({ message: 'Todos os campos obrigatórios devem ser preenchidos.' });
  }

  // Valida duração do jogo
  const inicio = new Date(`${data_jogo}T${horario_inicio}`);
  const fim = new Date(`${data_jogo}T${horario_fim}`);
  const duracao = fim - inicio;

  if (duracao > 12 * 60 * 60 * 1000) { // 12 horas em milissegundos
    console.error('[ERROR] A duração do jogo excede 12 horas.');
    return res.status(400).json({ message: 'A duração máxima do jogo é 12 horas.' });
  }
  if (duracao <= 0) {
    console.error('[ERROR] O horário de término é anterior ou igual ao horário de início.');
    return res
      .status(400)
      .json({ message: 'O horário de término deve ser após o horário de início.' });
  }

  const client = await db.getClient();
  try {
    console.log('[INFO] Iniciando transação para criar jogo.');
    await client.query('BEGIN');

    // Gerar id_numerico único
    let idNumerico;
    let isUnique = false;

    while (!isUnique) {
      idNumerico = Math.floor(100000 + Math.random() * 900000); // Gera um número de 6 dígitos
      const existing = await client.query('SELECT 1 FROM jogos WHERE id_numerico = $1', [idNumerico]);
      if (existing.rowCount === 0) {
        isUnique = true;
      }
    }

    console.log('[INFO] id_numerico gerado:', idNumerico);

    // Inserção do jogo na tabela 'jogos' com id_numerico
    console.log('[INFO] Inserindo jogo na tabela `jogos`.');
    const result = await client.query(
      `INSERT INTO jogos (
         nome_jogo, data_jogo, horario_inicio, horario_fim,
         limite_jogadores, id_usuario, descricao, chave_pix,
         status, id_numerico
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'aberto', $9)
       RETURNING id_jogo`,
      [
        nome_jogo,
        data_jogo,
        horario_inicio,
        horario_fim,
        limite_jogadores,
        id_usuario,
        descricao || null, // Preenche null se não enviado
        chave_pix || null, // Preenche null se não enviado
        idNumerico
      ]
    );

    const id_jogo = result.rows[0]?.id_jogo;
    if (!id_jogo) {
      throw new Error('Falha ao obter o ID do jogo recém-criado.');
    }
    console.log('[INFO] Jogo criado com ID:', id_jogo);

    // Inserção na tabela convites com id_usuario
    console.log('[INFO] Inserindo convite na tabela `convites`.');
    await client.query(
      `INSERT INTO convites (id_jogo, id_numerico, status, data_envio, id_usuario)
       VALUES ($1, $2, 'aberto', NOW(), $3)`,
      [id_jogo, idNumerico, id_usuario]
    );
    console.log('[INFO] Convite criado com sucesso.');

    // Inserir o organizador na tabela 'participacao_jogos'
    console.log('[INFO] Inserindo organizador na tabela `participacao_jogos`.');
    const participacaoResult = await client.query(
      `INSERT INTO participacao_jogos (id_jogo, id_usuario, lider_time, status)
       VALUES ($1, $2, $3, 'ativo')`,
      [id_jogo, id_usuario, true] // Passa true como parâmetro
    );

    console.log('[DEBUG] Resultado da inserção na tabela `participacao_jogos`:', participacaoResult.rowCount);

    if (participacaoResult.rowCount === 0) {
      console.error('[ERROR] Falha ao inserir o organizador na tabela `participacao_jogos`.');
      throw new Error('Erro ao adicionar o organizador como participante.');
    }

    // Inserção na tabela `usuario_funcao`
    console.log('[INFO] Inserindo organizador na tabela `usuario_funcao`.');
    const organizadorFuncao = await client.query(
      `SELECT id_funcao FROM funcao WHERE nome_funcao = 'organizador'`
    );

    if (organizadorFuncao.rowCount === 0) {
      throw new Error('Função "organizador" não encontrada no banco de dados.');
    }

    const id_funcao = organizadorFuncao.rows[0].id_funcao;

    await client.query(
      `INSERT INTO usuario_funcao (id_usuario, id_funcao, id_jogo)
       VALUES ($1, $2, $3)`,
      [id_usuario, id_funcao, id_jogo]
    );
    console.log('[INFO] Organizador associado à função "organizador" com sucesso.');

    await client.query('COMMIT'); // Finaliza a transação
    console.log('[INFO] Jogo criado com sucesso. Transação concluída.');

    return res
      .status(201)
      .json({ message: 'Jogo criado com sucesso.', id_jogo, id_numerico: idNumerico });
  } catch (error) {
    console.error('[ERROR] Erro ao criar jogo:', error.message);
    await client.query('ROLLBACK'); // Reverte alterações em caso de erro
    return res.status(500).json({ message: 'Erro interno ao criar o jogo.', error: error.message });
  } finally {
    client.release();
    console.log('[INFO] Conexão com o banco de dados liberada.');
  }
});

/**
 * ------------------------------------------------
 * GET /api/jogos/:id_jogo/detalhes
 * Retorna dados do jogo + participantes + times
 * ------------------------------------------------
 */
router.get('/:id_jogo/detalhes', authMiddleware, async (req, res) => {
  const { id_jogo } = req.params;
  const userId = req.user.id; // ID do usuário logado (jwt)

  console.log(`[INFO] Recebida solicitação para detalhes do jogo ID: ${id_jogo} pelo usuário ID: ${userId}`);

  if (!id_jogo) {
    console.error('[ERROR] ID do jogo não fornecido.');
    return res.status(400).json({ message: 'ID do jogo é obrigatório.' });
  }

  try {
    // 1) Buscar dados do jogo
    console.log('[INFO] Buscando dados do jogo.');
    const jogoResult = await db.query(
      `SELECT j.id_jogo, j.nome_jogo, j.data_jogo, j.horario_inicio, j.horario_fim,
              j.limite_jogadores, j.descricao, j.chave_pix, j.status, j.id_numerico,
              (CASE WHEN j.id_usuario = $1 THEN true ELSE false END) AS "isOrganizer"
         FROM jogos j
         WHERE j.id_jogo = $2
         LIMIT 1`,
      [userId, id_jogo]
    );

    if (jogoResult.rows.length === 0) {
      console.error('[ERROR] Jogo não encontrado.');
      return res.status(404).json({ message: 'Jogo não encontrado.' });
    }

    const jogo = jogoResult.rows[0];
    console.log('[INFO] Dados do jogo obtidos:', jogo);

    // 2) Buscar participações (ativo/na_espera)
    console.log('[INFO] Buscando participações dos jogadores.');
    const participacaoResult = await db.query(
      `SELECT pj.id_usuario, u.nome, pj.status, 
              COALESCE(pj.confirmado, false) AS confirmado,
              COALESCE(pj.pago, false) AS pago
       FROM participacao_jogos pj
       JOIN usuario u ON pj.id_usuario = u.id_usuario
       WHERE pj.id_jogo = $1
       ORDER BY u.nome ASC`,
      [id_jogo]
    );

    const ativos = participacaoResult.rows.filter(row => row.status === 'ativo');
    const espera = participacaoResult.rows.filter(row => row.status === 'na_espera');

    console.log(`[INFO] Participantes ativos: ${ativos.length}, em espera: ${espera.length}`);

    // 3) Buscar times formados na tabela "times"
    console.log('[INFO] Buscando times formados.');
    const timesResult = await db.query(
      `SELECT
         t.numero_time,
         t.id_usuario,
         t.total_score,
         t.total_altura,
         u.nome,
         COALESCE(a.passe, 3) AS passe,
         COALESCE(a.ataque, 3) AS ataque,
         COALESCE(a.levantamento, 3) AS levantamento
       FROM times t
       JOIN usuario u ON t.id_usuario = u.id_usuario
       LEFT JOIN avaliacoes a
         ON a.usuario_id = u.id_usuario
        AND a.organizador_id = $3
       WHERE t.id_jogo = $1
       ORDER BY t.numero_time, u.nome`,
      [id_jogo, userId, jogo.id_usuario] // Passa o id do organizador para as avaliações
    );

    // Agrupar por numero_time
    const mapTimes = {};
    for (const row of timesResult.rows) {
      const nt = row.numero_time;
      if (!mapTimes[nt]) {
        mapTimes[nt] = {
          nome: nt === 99 ? 'Reservas' : `Time ${nt}`,
          jogadores: []
        };
      }
      mapTimes[nt].jogadores.push({
        id_usuario: row.id_usuario,
        nome: row.nome,
        passe: row.passe,
        ataque: row.ataque,
        levantamento: row.levantamento,
        altura: row.total_altura || 0,
        total_score: row.total_score || 0
      });
    }

    // Montar arrays
    const times = [];
    const reservas = [];

    Object.entries(mapTimes).forEach(([numeroTime, info]) => {
      if (parseInt(numeroTime, 10) === 99) {
        // reservas
        reservas.push(...info.jogadores);
      } else {
        times.push({
          nome: info.nome, // ex: "Time 1"
          jogadores: info.jogadores
        });
      }
    });

    console.log('[INFO] Times e reservas organizados.');

    // Resposta final
    return res.status(200).json({
      // Jogo
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
      isOrganizer: jogo.isOrganizer, // boolean

      // Participantes
      jogadoresAtivos: ativos,
      jogadoresEspera: espera,

      // Times formados
      times,
      reservas
    });
  } catch (error) {
    console.error('[ERROR] Erro ao buscar detalhes do jogo:', error.message);
    return res
      .status(500)
      .json({ message: 'Erro interno ao buscar detalhes do jogo.', error: error.message });
  }
});

module.exports = router;
