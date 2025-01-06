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

    // **Inserção do organizador na tabela `times` como parte do Time 1**
    console.log('[INFO] Inserindo organizador na tabela `times` como parte do Time 1.');
    await client.query(
      `INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id_jogo,
        1, // Número do time
        id_usuario,
        0, // total_score inicial
        0  // total_altura inicial
      ]
    );
    console.log('[INFO] Organizador inserido no Time 1 com sucesso.');

    // **Inserção dos times balanceados na tabela `times`**
    // A lógica de balanceamento será tratada na rota /iniciar-balanceamento

    await client.query('COMMIT'); // Finaliza a transação
    console.log('[INFO] Jogo criado com sucesso. Transação concluída.');

    // Log do Retorno da API
    console.log('Retorno da API:', {
      message: 'Jogo criado com sucesso.',
      id_jogo,
      id_numerico: idNumerico
    });

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

// Rota para iniciar o balanceamento dos times
router.post('/iniciar-balanceamento', authMiddleware, async (req, res) => {
  const client = await db.getClient();
  try {
    console.log('=== Nova requisição: POST /api/jogos/iniciar-balanceamento ===');
    console.log('Body:', req.body);

    const { id_jogo } = req.body;

    if (!id_jogo) {
      client.release();
      return res.status(400).json({ error: 'ID do jogo é obrigatório.' });
    }

    console.log(`Verificando existência do jogo com id_jogo: ${id_jogo}`);
    const jogoResp = await client.query(`
      SELECT id_jogo, id_usuario, status, tamanho_time
      FROM jogos
      WHERE id_jogo = $1
      LIMIT 1
    `, [id_jogo]);

    if (jogoResp.rowCount === 0) {
      client.release();
      return res.status(404).json({
        error: 'Jogo não encontrado.',
      });
    }

    const { status, id_usuario, tamanho_time: tamanhoTimeDB } = jogoResp.rows[0];

    // Se jogo finalizado -> não deixa prosseguir
    if (status === 'finalizado') {
      client.release();
      return res.status(400).json({
        error: 'O jogo já foi finalizado e não pode ser balanceado novamente.',
      });
    }

    // Check de organizador
    if (id_usuario !== req.user.id) {
      client.release();
      return res.status(403).json({
        error: 'Apenas o organizador do jogo pode iniciar o balanceamento.',
      });
    }

    // Atualiza tamanho_time se vier no body
    let tamanhoTimeFinal = tamanhoTimeDB;
    if (typeof req.body.tamanho_time === 'number') {
      await client.query(`
        UPDATE jogos
           SET tamanho_time = $1
         WHERE id_jogo = $2
      `, [req.body.tamanho_time, id_jogo]);
      tamanhoTimeFinal = req.body.tamanho_time;
    }

    if (!tamanhoTimeFinal) {
      client.release();
      return res.status(200).json({
        message: 'O tamanho_time ainda não foi definido. Configure-o na tela do jogo.',
        status: 'pendente',
      });
    }

    // Buscar jogadores ativos do jogo com avaliações
    const jogadoresResp = await client.query(`
      SELECT pj.id_usuario, u.nome, 
             COALESCE(a.passe, 3) + COALESCE(a.ataque, 3) + COALESCE(a.levantamento, 3) AS score,
             u.altura
      FROM participacao_jogos pj
      JOIN usuario u ON pj.id_usuario = u.id_usuario
      LEFT JOIN avaliacoes a ON a.usuario_id = u.id_usuario AND a.organizador_id = $1
      WHERE pj.id_jogo = $2 AND pj.status = 'ativo'
      ORDER BY score DESC
    `, [req.user.id, id_jogo]);

    const jogadores = jogadoresResp.rows;

    console.log('Detalhes do jogo:', jogadores);

    if (jogadores.length === 0) {
      throw new Error('Nenhum jogador ativo encontrado para balanceamento.');
    }

    // Lógica de balanceamento simples (exemplo: alternar jogadores entre os times)
    const balancedTimes = [];
    for (let i = 0; i < 2; i++) { // Exemplo: 2 times
      balancedTimes.push({
        numero_time: i + 1,
        jogadores: [],
      });
    }

    // Ordenar os jogadores com base no score já foi feito pela consulta
    jogadores.forEach((jogador, index) => {
      const timeIndex = index % balancedTimes.length;
      balancedTimes[timeIndex].jogadores.push(jogador);
    });

    console.log('Times balanceados:', balancedTimes);

    // Inserir os jogadores balanceados na tabela `times`
    console.log('[INFO] Inserindo jogadores balanceados na tabela `times`.');
    for (const time of balancedTimes) {
      for (const jogador of time.jogadores) {
        // Calcular total_score e total_altura
        const totalScore = jogador.score || 0;
        const totalAltura = jogador.altura || 0;

        // Inserir na tabela `times`
        await client.query(`
          INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          id_jogo,
          time.numero_time,
          jogador.id_usuario,
          totalScore,
          totalAltura,
        ]);
        console.log(`[INFO] Jogador ${jogador.nome} inserido no Time ${time.numero_time}.`);
      }
    }

    await client.query('COMMIT');
    client.release();

    console.log('[INFO] Balanceamento concluído com sucesso.');

    return res.status(200).json({
      message: 'Balanceamento realizado com sucesso.',
      times: balancedTimes,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    console.error('[ERROR] Erro ao balancear times:', error.message);
    return res.status(500).json({
      message: 'Erro interno ao balancear os times.',
      error: error.message,
    });
  }
});

// Rota para buscar os times de um jogo específico
router.get('/:id_jogo/times', authMiddleware, async (req, res) => {
  const { id_jogo } = req.params;

  try {
    const result = await db.query(`
      SELECT 
          t.id AS id_time,
          t.numero_time,
          u.id_usuario,
          u.nome AS nome_jogador,
          t.total_score,
          t.total_altura
      FROM times t
      LEFT JOIN usuario u ON t.id_usuario = u.id_usuario
      WHERE t.id_jogo = $1
      ORDER BY t.numero_time, u.nome;
    `, [id_jogo]);

    console.log('Times balanceados:', result.rows);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar times:', error);
    res.status(500).json({ message: 'Erro interno ao buscar times.', error: error.message });
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
      `SELECT t.id AS id_time, t.numero_time, t.id_usuario, 
              u.nome AS nome_jogador, t.total_score, t.total_altura
       FROM times t
       LEFT JOIN usuario u ON t.id_usuario = u.id_usuario
       WHERE t.id_jogo = $1
       ORDER BY t.numero_time, u.nome;`,
      [id_jogo]
    );

    const times = timesResult.rows;

    // Log dos detalhes do jogo e times balanceados
    console.log('Detalhes do jogo:', jogo);
    console.log('Times balanceados:', times);

    // Log do Retorno da API
    console.log('Retorno da API:', {
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
    return res.status(500).json({ message: 'Erro interno ao buscar detalhes do jogo.', error: error.message });
  }
});

module.exports = router;
