// routes/balanceamentoRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../../db'); // Conexão com o banco de dados
const authMiddleware = require('../../middlewares/authMiddleware');
const roleMiddleware = require('../../middlewares/roleMiddleware');

// Função para embaralhar (Fisher-Yates shuffle)
const embaralharJogadores = (jogadores) => {
  for (let i = jogadores.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [jogadores[i], jogadores[j]] = [jogadores[j], jogadores[i]];
  }
  return jogadores;
};

// Função para calcular variância
const calcularVariancia = (valores) => {
  if (valores.length === 0) return 0;
  const media = valores.reduce((sum, v) => sum + v, 0) / valores.length;
  return valores.reduce((sum, v) => sum + Math.pow(v - media, 2), 0) / valores.length;
};

// Função de custo
const calcularCusto = (times, pesoPontuacao = 1, pesoAltura = 1) => {
  const pontuacoes = times.map(t => t.totalScore);
  const alturasMedias = times.map(t =>
    t.jogadores.length > 0 ? t.totalAltura / t.jogadores.length : 0
  );
  const varPontuacao = calcularVariancia(pontuacoes);
  const varAltura = calcularVariancia(alturasMedias);

  return (pesoPontuacao * varPontuacao) + (pesoAltura * varAltura);
};

// Função para calcular distância euclidiana (opcional)
const calcularDistancia = (jogador1, jogador2) => {
  const alturaDiff = jogador1.altura - jogador2.altura;
  const passeDiff = jogador1.passe - jogador2.passe;
  const ataqueDiff = jogador1.ataque - jogador2.ataque;
  const levantamentoDiff = jogador1.levantamento - jogador2.levantamento;

  return Math.sqrt(
    Math.pow(alturaDiff, 2) +
      Math.pow(passeDiff, 2) +
      Math.pow(ataqueDiff, 2) +
      Math.pow(levantamentoDiff, 2)
  );
};

// Gerar sugestões de rotação
const gerarSugerirRotacoes = (times, reservas, topN = 2) => {
  const rotacoes = [];

  reservas.forEach(reserva => {
    const sugeridos = [];
    times.forEach((time, timeIndex) => {
      time.jogadores.forEach(jogador => {
        const distancia = calcularDistancia(reserva, jogador);
        sugeridos.push({
          time: timeIndex + 1,
          jogador,
          distancia
        });
      });
    });

    // Ordena por menor distância
    sugeridos.sort((a, b) => a.distancia - b.distancia);

    // Pega topN
    const topSugeridos = sugeridos.slice(0, topN).map(s => ({
      time: s.time,
      jogador: s.jogador,
      distancia: s.distancia.toFixed(2)
    }));

    rotacoes.push({
      reserva,
      sugeridos: topSugeridos
    });
  });

  return rotacoes;
};

/* ===================================================================
   1) /iniciar-balanceamento
   2) /finalizar-balanceamento
=================================================================== */

/**
 * POST /api/jogador/iniciar-balanceamento
 * Marca o status do jogo como 'equilibrando'
 */
router.post(
  '/iniciar-balanceamento',
  authMiddleware,
  roleMiddleware(['organizador']),
  async (req, res) => {
    try {
      const { id_jogo } = req.body;
      console.log('Recebido /iniciar-balanceamento:', req.body);

      if (!id_jogo) {
        return res.status(400).json({
          error: 'O campo id_jogo é obrigatório.',
        });
      }

      // Verifica se o jogo existe
      const jogoQuery = await db.query(
        `SELECT id_jogo, id_usuario, status FROM jogos WHERE id_jogo = $1 LIMIT 1`,
        [id_jogo]
      );

      if (jogoQuery.rowCount === 0) {
        return res.status(404).json({
          error: 'Jogo não encontrado.',
        });
      }

      const { id_usuario: organizador_id, status } = jogoQuery.rows[0];

      // Se já estiver equilibrando ou "encerrado", impedimos (ajuste conforme regra de negócio).
      if (status === 'equilibrando' || status === 'finalizado') {
        return res.status(400).json({
          error: 'O jogo já está em balanceamento ou foi finalizado.',
        });
      }

      // Atualiza o status do jogo para "equilibrando"
      const updateStatus = await db.query(
        `UPDATE jogos 
            SET status = 'equilibrando' 
          WHERE id_jogo = $1 
          RETURNING *`,
        [id_jogo]
      );

      if (updateStatus.rowCount === 0) {
        throw new Error('Erro ao atualizar status do jogo: ID do jogo não encontrado.');
      }
      console.log('[INFO] Status atualizado para "equilibrando":', updateStatus.rows[0]);

      // Garantir que o papel "organizador" para este jogo está salvo, sem expiração.
      await db.query(
        `INSERT INTO usuario_funcao (id_usuario, id_funcao, id_jogo, criado_em)
         VALUES ($1, 1, $2, NOW())
         ON CONFLICT (id_usuario, id_funcao, id_jogo) 
         DO NOTHING`,
        [organizador_id, id_jogo]
      );

      return res.status(200).json({
        message: 'O organizador iniciou o balanceamento.',
        status: 'equilibrando',
        id_jogo: id_jogo,
      });
    } catch (error) {
      console.error('Erro ao iniciar balanceamento:', error);
      return res.status(500).json({
        error: 'Erro ao iniciar balanceamento.',
        details: error.message,
      });
    }
  }
);

/**
 * POST /api/jogador/finalizar-balanceamento
 * Marca o status do jogo como 'finalizado'
 * Retorna times gerados (ou armazenados) para exibir ao usuário
 */
router.post(
  '/finalizar-balanceamento',
  authMiddleware,
  async (req, res) => {
    try {
      const { id_jogo, id_usuario_organizador, times } = req.body;
      console.log('Recebido /finalizar-balanceamento:', req.body);

      // Validações
      if (!id_jogo || !id_usuario_organizador || !times) {
        return res.status(400).json({
          error: 'id_jogo, id_usuario_organizador e times são obrigatórios.',
        });
      }

      // Verifica se o jogo existe e se o solicitante é o organizador
      const jogoQuery = await db.query(
        `SELECT id_usuario, status FROM jogos WHERE id_jogo = $1 LIMIT 1`,
        [id_jogo]
      );

      if (jogoQuery.rowCount === 0) {
        return res.status(404).json({ error: 'Jogo não encontrado.' });
      }

      const { id_usuario: organizador_id, status } = jogoQuery.rows[0];

      if (parseInt(organizador_id, 10) !== parseInt(id_usuario_organizador, 10)) {
        return res.status(403).json({
          error: 'Somente o organizador pode finalizar o balanceamento.',
        });
      }

      if (status !== 'equilibrando') {
        return res.status(400).json({
          error: 'O jogo não está em estado de balanceamento.',
        });
      }

      // Atualiza o status do jogo para "finalizado"
      await db.query(
        `UPDATE jogos SET status = 'finalizado' WHERE id_jogo = $1`,
        [id_jogo]
      );

      // *** Removido trecho que excluía a função de organizador ***
      // (Não queremos que ele perca o papel de organizador no jogo que criou.)

      // (Opcional) Salvar os times no banco
      for (const [index, time] of times.entries()) {
        for (const jogador of time.jogadores) {
          await db.query(
            `INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              id_jogo,
              index + 1, // número do time (1, 2, ...)
              jogador.id_usuario,
              time.totalScore,
              time.totalAltura,
            ]
          );
        }
      }

      return res.status(200).json({
        message: 'Balanceamento finalizado.',
        status: 'finalizado',
        id_jogo,
        times,
      });
    } catch (error) {
      console.error('Erro ao finalizar balanceamento:', error);
      return res.status(500).json({
        error: 'Erro ao finalizar balanceamento.',
        details: error.message,
      });
    }
  }
);

/* ===================================================================
   ROTA DE EQUILIBRAR TIMES (já existente)
=================================================================== */
router.post('/equilibrar-times', async (req, res) => {
  console.log('==== Requisição recebida em /equilibrar-times ====');
  console.log('Payload recebido:', JSON.stringify(req.body, null, 2));

  const { organizador_id, id_jogo, tamanho_time, jogadores } = req.body;

  if (!organizador_id || !tamanho_time) {
    return res.status(400).json({
      message: 'Organizador e tamanho do time são obrigatórios.',
    });
  }

  if (!jogadores || !Array.isArray(jogadores) || jogadores.length === 0) {
    return res.status(400).json({
      message: 'É necessário fornecer a lista de jogadores selecionados.',
    });
  }

  try {
    console.log('Consultando jogadores no banco de dados com base nos selecionados...');

    const baseIndex = id_jogo ? 3 : 2;
    const playerIds = jogadores.map(jogador => jogador.id_usuario); // Extrai apenas os IDs
    const placeholders = playerIds.map((_, index) => `$${index + baseIndex}`).join(', ');

    const query = `
      SELECT 
        u.nome, 
        u.id_usuario AS usuario_id, 
        u.altura, 
        COALESCE(a.passe, 0) AS passe, 
        COALESCE(a.ataque, 0) AS ataque, 
        COALESCE(a.levantamento, 0) AS levantamento
      FROM avaliacoes a
      JOIN usuario u ON a.usuario_id = u.id_usuario
      ${id_jogo ? 'JOIN participacao_jogos pj ON pj.id_usuario = a.usuario_id' : ''}
      WHERE a.organizador_id = $1
      ${id_jogo ? 'AND pj.id_jogo = $2' : ''}
      AND a.usuario_id IN (${placeholders})
    `;

    const params = id_jogo
      ? [organizador_id, id_jogo, ...playerIds]
      : [organizador_id, ...playerIds];

    console.log('Executando consulta SQL:', query, '| Parâmetros:', params);
    const jogadoresResult = await db.query(query, params);

    if (jogadoresResult.rows.length === 0) {
      return res.status(404).json({ message: 'Nenhum jogador encontrado com os critérios fornecidos.' });
    }

    let jogadoresComPontuacao = jogadoresResult.rows.map((jogador) => ({
      id: jogador.usuario_id, // Mapeia para o campo correto
      nome: jogador.nome,
      altura: parseFloat(jogador.altura) || 0,
      passe: jogador.passe,
      ataque: jogador.ataque,
      levantamento: jogador.levantamento,
      total: jogador.passe + jogador.ataque + jogador.levantamento,
    }));

    // Embaralha
    jogadoresComPontuacao = embaralharJogadores(jogadoresComPontuacao);
    // Ordena desc
    jogadoresComPontuacao.sort((a, b) => b.total - a.total);

    const numero_times = Math.floor(jogadoresComPontuacao.length / tamanho_time);

    if (numero_times < 1) {
      return res.status(400).json({
        message: 'Jogadores insuficientes para formar ao menos um time completo.',
      });
    }

    if (jogadoresComPontuacao.length < tamanho_time * 2) {
      return res.status(400).json({
        message: `Jogadores insuficientes. Necessário no mínimo ${tamanho_time * 2} jogadores para formar 2 times.`,
      });
    }

    // Separa levantadores
    let levantadores = jogadoresComPontuacao.filter(j => j.levantamento >= 4);
    let naoLevantadores = jogadoresComPontuacao.filter(j => j.levantamento < 4);

    console.log(`Total de levantadores: ${levantadores.length}`);
    console.log(`Total de não-levantadores: ${naoLevantadores.length}`);

    // Ajustar levantadores se insuficientes
    if (levantadores.length < numero_times) {
      naoLevantadores.sort((a, b) => b.levantamento - a.levantamento);
      const needed = numero_times - levantadores.length;
      const substitutos = naoLevantadores.slice(0, needed);
      naoLevantadores = naoLevantadores.slice(needed);
      levantadores = levantadores.concat(substitutos);

      if (levantadores.length < numero_times) {
        return res.status(400).json({
          message: 'Não foi possível garantir um levantador ou substituto para cada time.'
        });
      }
    }

    // Cria estrutura dos times
    const times = Array.from({ length: numero_times }, () => ({
      jogadores: [],
      totalScore: 0,
      totalAltura: 0,
    }));

    // Distribui 1 levantador em cada time
    levantadores.sort((a, b) => b.total - a.total);
    for (let i = 0; i < numero_times; i++) {
      const lev = levantadores[i];
      times[i].jogadores.push(lev);
      times[i].totalScore += lev.total;
      times[i].totalAltura += lev.altura;
    }

    const jogadoresAlocados = times.flatMap(t => t.jogadores.map(j => j.id));
    let reservas = jogadoresComPontuacao.filter(j => !jogadoresAlocados.includes(j.id));

    let filtrados = reservas.slice();
    filtrados.sort((a, b) => b.total - a.total);
    filtrados = embaralharJogadores(filtrados);

    const pesoPontuacao = 1;
    const pesoAltura = 1;

    // Distribuir os demais jogadores
    filtrados.forEach(jogador => {
      let melhorTime = -1;
      let melhorCusto = Infinity;
      const custoInicial = calcularCusto(times, pesoPontuacao, pesoAltura);

      for (let t = 0; t < numero_times; t++) {
        if (times[t].jogadores.length >= tamanho_time) {
          continue;
        }
        const hipotetico = [...times[t].jogadores, jogador];
        const custoFinal = calcularCusto(
          [
            ...times.slice(0, t),
            {
              jogadores: hipotetico,
              totalScore: times[t].totalScore + jogador.total,
              totalAltura: times[t].totalAltura + jogador.altura,
            },
            ...times.slice(t + 1),
          ],
          pesoPontuacao,
          pesoAltura
        );
        const delta = custoFinal - custoInicial;
        if (delta < melhorCusto) {
          melhorCusto = delta;
          melhorTime = t;
        }
      }

      if (melhorTime !== -1 && times[melhorTime].jogadores.length < tamanho_time) {
        times[melhorTime].jogadores.push(jogador);
        times[melhorTime].totalScore += jogador.total;
        times[melhorTime].totalAltura += jogador.altura;
      }
    });

    // Reserva final
    const jogadoresAlocadosFinal = times.flatMap(t => t.jogadores.map(j => j.id));
    let reservasFinal = jogadoresComPontuacao.filter(j => !jogadoresAlocadosFinal.includes(j.id));
    reservasFinal = embaralharJogadores(reservasFinal);

    console.log('Times equilibrados:', JSON.stringify(times, null, 2));
    console.log('Jogadores em reserva:', JSON.stringify(reservasFinal, null, 2));

    const rotacoes = gerarSugerirRotacoes(times, reservasFinal, 2);
    console.log('Sugestões de Rotação:', JSON.stringify(rotacoes, null, 2));

    // Checagem final
    for (let i = 0; i < numero_times; i++) {
      if (times[i].jogadores.length !== tamanho_time) {
        return res.status(500).json({
          message: `Erro interno: o time ${i + 1} não atingiu o tamanho esperado de ${tamanho_time} jogadores.`,
          time: times[i],
        });
      }
    }

    return res.json({
      id_jogo: id_jogo || req.body.id_jogo,
      times: times.map((time, index) => ({
        numero_time: index + 1,
        jogadores: time.jogadores.map((jogador) => ({
          id_usuario: jogador.id, // Garantindo que o campo seja `id_usuario`
          nome: jogador.nome,
          passe: jogador.passe,
          ataque: jogador.ataque,
          levantamento: jogador.levantamento,
        })),
        totalScore: time.totalScore,
        totalAltura: time.totalAltura,
      })),
      reservas: reservasFinal.map((reserva) => ({
        id_usuario: reserva.id, // Incluindo também no formato `id_usuario`
        nome: reserva.nome,
        passe: reserva.passe,
        ataque: reserva.ataque,
        levantamento: reserva.levantamento,
      })),
      rotacoes,
    });
  } catch (error) {
    console.error('Erro ao equilibrar times:', error);
    return res.status(500).json({ message: 'Erro ao equilibrar times.', error: error.message });
  }
});
// DANTAS
router.post(
  '/atualizar-times',
  authMiddleware,
  roleMiddleware(['organizador']),
  async (req, res) => {
    try {
      const { id_jogo, times } = req.body;

      // Validação dos parâmetros
      if (!id_jogo || !times || !Array.isArray(times)) {
        return res.status(400).json({
          error: 'id_jogo e times são obrigatórios, e times deve ser uma lista.',
        });
      }

      // Verifica se o jogo existe
      const jogoQuery = await db.query(
        `SELECT id_jogo FROM jogos WHERE id_jogo = $1 LIMIT 1`,
        [id_jogo]
      );

      if (jogoQuery.rowCount === 0) {
        return res.status(404).json({
          error: 'Jogo não encontrado.',
        });
      }

      // Atualiza os times no banco de dados (formato JSON armazenado no campo `times`)
      await db.query(
        `UPDATE jogos 
         SET times = $1 
         WHERE id_jogo = $2`,
        [JSON.stringify(times), id_jogo]
      );

      console.log(`[INFO] Times atualizados para o jogo ID: ${id_jogo}`);

      return res.status(200).json({
        message: 'Times atualizados com sucesso!',
        times,
      });
    } catch (error) {
      console.error('Erro ao atualizar times:', error);
      return res.status(500).json({
        error: 'Erro ao atualizar os times.',
        details: error.message,
      });
    }
  }
);

// DANTAS

module.exports = router;
