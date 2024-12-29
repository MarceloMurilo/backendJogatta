const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');
const roleMiddleware = require('../../middlewares/roleMiddleware');

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
    descricao, // Opcional
    chave_pix // Opcional
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

    // Inserção do jogo na tabela 'jogos'
    console.log('[INFO] Inserindo jogo na tabela `jogos`.');
    const result = await client.query(
      `INSERT INTO jogos (nome_jogo, data_jogo, horario_inicio, horario_fim, limite_jogadores, id_usuario, descricao, chave_pix, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'aberto')
       RETURNING id_jogo`,
      [
        nome_jogo,
        data_jogo,
        horario_inicio,
        horario_fim,
        limite_jogadores,
        id_usuario,
        descricao || null, // Preenche null se não enviado
        chave_pix || null  // Preenche null se não enviado
      ]
    );

    const id_jogo = result.rows[0]?.id_jogo;
    if (!id_jogo) {
      throw new Error('Falha ao obter o ID do jogo recém-criado.');
    }
    console.log('[INFO] Jogo criado com ID:', id_jogo);

    // Inserir o organizador na tabela 'participacao_jogos'
    console.log('[INFO] Inserindo participação do organizador na tabela `participacao_jogos`.');
    await client.query(
      `INSERT INTO participacao_jogos (id_jogo, id_usuario, data_participacao, status)
       VALUES ($1, $2, NOW(), 'ativo')`,
      [id_jogo, id_usuario]
    );

    await client.query('COMMIT'); // Finaliza a transação
    console.log('[INFO] Jogo criado com sucesso. Transação concluída.');

    return res
      .status(201)
      .json({ message: 'Jogo criado com sucesso.', id_jogo });
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
              j.limite_jogadores, j.descricao, j.chave_pix, j.status,
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
      `SELECT pj.id_usuario, u.nome, pj.status AS status, 
              COALESCE((pj.data_pagamento IS NOT NULL), false) AS pago,
              COALESCE((pj.data_confirmacao IS NOT NULL), false) AS confirmado
       FROM participacao_jogos pj
       JOIN usuario u ON pj.id_usuario = u.id_usuario
       WHERE pj.id_jogo = $1`,
      [id_jogo]
    );

    const ativos = [];
    const espera = [];
    participacaoResult.rows.forEach((row) => {
      if (row.status === 'ativo') ativos.push(row);
      else espera.push(row);
    });

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
      isOrganizer: jogo.isOrganizer,
      jogadoresAtivos: ativos,
      jogadoresEspera: espera,
    });
  } catch (error) {
    console.error('Erro ao buscar detalhes do jogo:', error.message);
    return res.status(500).json({ message: 'Erro interno ao buscar detalhes do jogo.' });
  }
});

// Rota para gerar convite
router.post('/convites/gerar', authMiddleware, async (req, res) => {
  const { id_jogo, id_usuario } = req.body;
  try {
    const idNumerico = Math.floor(100000 + Math.random() * 900000);
    const link = `https://seusite.com/sala/${idNumerico}`;

    await db.query(
      `INSERT INTO convites (id_jogo, id_usuario, id_numerico, link)
       VALUES ($1, $2, $3, $4)`,
      [id_jogo, id_usuario, idNumerico, link]
    );

    return res.status(200).json({
      convite: {
        id_numerico: idNumerico,
        link,
      },
    });
  } catch (error) {
    console.error('Erro ao gerar convite:', error.message);
    return res.status(500).json({ message: 'Erro ao gerar convite.' });
  }
});

module.exports = router;
