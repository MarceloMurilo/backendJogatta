// src/routes/jogosRoutes.js

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
  console.log(`==============================`);
  next();
});

// Rota para criar um jogo
router.post('/criar', authMiddleware, async (req, res) => {
  const {
    nome_jogo,
    data_jogo,
    horario_inicio,
    horario_fim,
    limite_jogadores,
    id_usuario,
    descricao,
    chave_pix
  } = req.body;

  console.log('[INFO] Recebida solicitação para criar jogo:', {
    nome_jogo,
    data_jogo,
    horario_inicio,
    horario_fim,
    limite_jogadores,
    id_usuario,
    descricao,
    chave_pix
  });

  // Verifica campos obrigatórios
  if (
    !nome_jogo ||
    !data_jogo ||
    !horario_inicio ||
    !horario_fim ||
    !limite_jogadores ||
    !id_usuario
  ) {
    console.error('[ERROR] Campos obrigatórios ausentes.');
    return res.status(400).json({ message: 'Todos os campos obrigatórios devem ser preenchidos.' });
  }

  // Valida duração do jogo
  const duracao = new Date(`${data_jogo}T${horario_fim}`) - new Date(`${data_jogo}T${horario_inicio}`);
  if (duracao > 12 * 60 * 60 * 1000) {
    console.error('[ERROR] A duração do jogo excede 12 horas.');
    return res.status(400).json({ message: 'A duração máxima do jogo é 12 horas.' });
  }
  if (duracao <= 0) {
    console.error('[ERROR] O horário de término é anterior ao horário de início.');
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
      idNumerico = Math.floor(100000 + Math.random() * 900000);
      const existing = await client.query('SELECT 1 FROM jogos WHERE id_numerico = $1', [idNumerico]);
      if (existing.rowCount === 0) isUnique = true;
    }

    // Inserção do jogo na tabela 'jogos' com id_numerico
    console.log('[INFO] Inserindo jogo na tabela `jogos`.');
    const result = await client.query(
      `INSERT INTO jogos (nome_jogo, data_jogo, horario_inicio, horario_fim, limite_jogadores, id_usuario, descricao, chave_pix, status, id_numerico)
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

    // **Inserção na tabela convites com id_usuario**
    console.log('[INFO] Inserindo convite na tabela `convites`.');
    await client.query(
      `INSERT INTO convites (id_jogo, id_numerico, status, data_envio, id_usuario)
       VALUES ($1, $2, $3, NOW(), $4)`,
      [id_jogo, idNumerico, 'aberto', id_usuario] // Inclui o id_usuario
    );
    console.log('[INFO] Convite criado com sucesso.');

    // Inserir o organizador na tabela 'participacao_jogos'
    console.log('[INFO] Inserindo organizador na tabela `participacao_jogos`.');
    const participacaoResult = await client.query(
      `INSERT INTO participacao_jogos (id_jogo, id_usuario, lider_time, status)
       VALUES ($1, $2, $3, 'ativo')`,
      [id_jogo, id_usuario, true]
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

    // **Inserção dos times balanceados na tabela `times_jogos`**
    console.log('[INFO] Inserindo times balanceados na tabela `times_jogos`.');
    const times = [
      { nome: 'Time A', jogadores: [] },
      { nome: 'Time B', jogadores: [] },
    ];

    for (const time of times) {
      await client.query(
        `INSERT INTO times_jogos (id_jogo, nome_time)
         VALUES ($1, $2)`,
        [id_jogo, time.nome]
      );
      console.log(`[INFO] ${time.nome} inserido com sucesso.`);
    }

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

// Rota para detalhes do jogo
router.get('/:id_jogo/detalhes', authMiddleware, async (req, res) => {
  const { id_jogo } = req.params;

  if (!id_jogo) {
    return res.status(400).json({ message: 'ID do jogo é obrigatório.' });
  }

  try {
    const jogoResult = await db.query(
      `SELECT j.id_jogo, j.nome_jogo, j.data_jogo, j.horario_inicio, j.horario_fim,
              j.limite_jogadores, j.descricao, j.chave_pix, j.status, j.id_numerico,
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

    // **Consulta os times balanceados**
    const timesResult = await db.query(
      `SELECT id_time, nome_time
       FROM times_jogos
       WHERE id_jogo = $1`,
      [id_jogo]
    );

    const times = timesResult.rows;

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
      isOrganizer: jogo.isOrganizer,
      jogadoresAtivos: ativos,
      jogadoresEspera: espera,
      timesBalanceados: times, // Adiciona os times balanceados
    });
  } catch (error) {
    console.error('Erro ao buscar detalhes do jogo:', error.message);
    return res.status(500).json({ message: 'Erro interno ao buscar detalhes do jogo.' });
  }
});

module.exports = router;
