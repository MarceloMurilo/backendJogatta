const express = require('express');
const router = express.Router();
const db = require('../../db');

// Middlewares
const authMiddleware = require('../../middlewares/authMiddleware');
const roleMiddleware = require('../../middlewares/roleMiddleware');

/**
 * ======================================
 * Funções Utilitárias
 * ======================================
 */
const calcularTotais = (time) => {
  const totalScore = time.jogadores.reduce(
    (sum, jogador) => sum + (jogador.passe + jogador.ataque + jogador.levantamento),
    0
  );
  const totalAltura = time.jogadores.reduce(
    (sum, jogador) => sum + (parseFloat(jogador.altura) || 0),
    0
  );
  return { totalScore, totalAltura };
};

const embaralharJogadores = (jogadores) => {
  for (let i = jogadores.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [jogadores[i], jogadores[j]] = [jogadores[j], jogadores[i]];
  }
  return jogadores;
};

const calcularVariancia = (valores) => {
  if (valores.length === 0) return 0;
  const media = valores.reduce((sum, v) => sum + v, 0) / valores.length;
  return valores.reduce((sum, v) => sum + Math.pow(v - media, 2), 0) / valores.length;
};

const calcularBalanceamentoGenero = (times) => {
  const distribuicaoGenero = times.map(time => ({
    feminino: time.jogadores.filter(j => j.genero === 'F').length,
    masculino: time.jogadores.filter(j => j.genero === 'M').length
  }));
  
  const varFeminino = calcularVariancia(distribuicaoGenero.map(d => d.feminino));
  const varMasculino = calcularVariancia(distribuicaoGenero.map(d => d.masculino));
  
  return varFeminino + varMasculino;
};

const calcularCusto = (times, pesoPontuacao = 1, pesoAltura = 1, pesoGenero = 2) => {
  const pontuacoes = times.map((t) => t.totalScore);
  const alturasMedias = times.map((t) =>
    t.jogadores.length > 0 ? t.totalAltura / t.jogadores.length : 0
  );
  const varPontuacao = calcularVariancia(pontuacoes);
  const varAltura = calcularVariancia(alturasMedias);
  const varGenero = calcularBalanceamentoGenero(times);
  
  return pesoPontuacao * varPontuacao + pesoAltura * varAltura + pesoGenero * varGenero;
};

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

/**
 * ======================================
 * Função de balanceamento com distribuição equilibrada de mulheres,
 * com randomização a cada chamada.
 * ======================================
 *
 * 1. Separa os jogadores fixos (levantadores) dos flexíveis.
 * 2. Embaralha os fixos e flexíveis para que a ordem seja aleatória.
 * 3. Nos times já formados com os fixos, conta quantas jogadoras já existem.
 * 4. Calcula a meta de jogadoras por time (total de mulheres / número de times).
 * 5. Embaralha os flexíveis do gênero "F" e os distribui para atingir a meta.
 * 6. Embaralha os demais jogadores (não "F") e preenche as vagas restantes.
 */
function balancearJogadores(jogadores, tamanhoTime) {
  console.log('Iniciando balanceamento com jogadores:', 
    jogadores.map(j => ({ nome: j.nome, genero: j.genero }))
  );

  // Separar fixos e flexíveis
  const fixed = jogadores.filter(j => j.isLevantador);
  const flexible = jogadores.filter(j => !j.isLevantador);

  // Embaralhar ambos os grupos para garantir randomização
  embaralharJogadores(fixed);
  embaralharJogadores(flexible);

  const totalPlayers = jogadores.length;
  const numTimes = Math.floor(totalPlayers / tamanhoTime) || 1;

  // Inicializa os times
  const times = [];
  for (let i = 0; i < numTimes; i++) {
    times.push({
      nomeTime: `Time ${i + 1}`,
      jogadores: [],
      totalScore: 0,
      totalAltura: 0,
    });
  }
  const reservas = [];

  // Distribuir os fixos (round-robin)
  fixed.forEach((player, idx) => {
    const teamIndex = idx % numTimes;
    if (times[teamIndex].jogadores.length < tamanhoTime) {
      times[teamIndex].jogadores.push(player);
    } else {
      reservas.push(player);
    }
  });

  // Nos fixos, já temos algumas jogadoras
  const fixedFemalesCounts = times.map(team =>
    team.jogadores.filter(j => j.genero === 'F').length
  );

  // Nos flexíveis, separe por gênero
  const flexibleFemales = flexible.filter(j => j.genero === 'F');
  const flexibleOthers = flexible.filter(j => j.genero !== 'F');

  // Embaralhar as listas para que a ordem seja aleatória a cada clique
  embaralharJogadores(flexibleFemales);
  embaralharJogadores(flexibleOthers);

  // Calcular o total de mulheres (fixos + flexíveis)
  const totalFemales = flexibleFemales.length + fixedFemalesCounts.reduce((s, c) => s + c, 0);
  // Meta de jogadoras por time
  const baseTarget = Math.floor(totalFemales / numTimes);
  const remainder = totalFemales % numTimes;
  const targetFemalesPerTeam = times.map((_, i) =>
    i < remainder ? baseTarget + 1 : baseTarget
  );

  console.log('Meta de jogadoras por time:', targetFemalesPerTeam);

  // Distribuir os flexíveis do gênero "F" nos times que estão abaixo da meta
  flexibleFemales.forEach(player => {
    let bestTeamIndex = -1;
    let maxDeficit = -Infinity;
    for (let i = 0; i < numTimes; i++) {
      if (times[i].jogadores.length < tamanhoTime) {
        const currentFemales = times[i].jogadores.filter(j => j.genero === 'F').length;
        const deficit = targetFemalesPerTeam[i] - currentFemales;
        if (deficit > maxDeficit) {
          maxDeficit = deficit;
          bestTeamIndex = i;
        }
      }
    }
    if (bestTeamIndex !== -1) {
      times[bestTeamIndex].jogadores.push(player);
    } else {
      reservas.push(player);
    }
  });

  // Preencher as vagas restantes com os jogadores não femininos
  flexibleOthers.forEach(player => {
    let assigned = false;
    for (let i = 0; i < numTimes; i++) {
      if (times[i].jogadores.length < tamanhoTime) {
        times[i].jogadores.push(player);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      reservas.push(player);
    }
  });

  // Recalcular totais para cada time
  times.forEach(time => {
    const { totalScore, totalAltura } = calcularTotais(time);
    time.totalScore = totalScore;
    time.totalAltura = totalAltura;
  });

  console.log('Times finais:', times.map(time => ({
    nomeTime: time.nomeTime,
    totalJogadores: time.jogadores.length,
    totalFemales: time.jogadores.filter(j => j.genero === 'F').length
  })));

  return { times, reservas };
}

/**
 * Middleware para balancear a role com base na presença de id_jogo
 */
function balancearRole(req, res, next) {
  if (req.body.id_jogo) {
    return roleMiddleware(['organizador'])(req, res, next);
  } else {
    return roleMiddleware(['jogador'], { skipIdJogo: true })(req, res, next);
  }
}

/**
 * ======================================
 * ROTAS DE BALANCEAMENTO
 * ======================================
 */

/**
 * POST /api/balanceamento/iniciar-balanceamento
 * - OFFLINE: recebe `amigos_offline` e balanceia sem gravar no DB.
 * - ONLINE: verifica o jogo, busca jogadores e grava times no DB.
 */
router.post(
  '/iniciar-balanceamento',
  authMiddleware,
  balancearRole,
  async (req, res) => {
    try {
      console.log('Dados recebidos no backend:', req.body);
      const { tamanho_time, amigos_offline = [] } = req.body;

      // FLUXO OFFLINE para teste
      console.log('Jogadores recebidos offline:', amigos_offline);
      
      const jogadoresTemporariosProntos = amigos_offline.map(frontJog => ({
        ...frontJog,
        nome: frontJog.nome?.trim() || `Jogador Temporário ${frontJog.id_usuario}`,
        passe: parseInt(frontJog.passe, 10) || 3,
        ataque: parseInt(frontJog.ataque, 10) || 3,
        levantamento: parseInt(frontJog.levantamento, 10) || 3,
        altura: parseFloat(frontJog.altura) || 170,
        genero: frontJog.genero // Deve vir já definido (ex: "F" ou "M")
      }));

      console.log('Jogadores processados:', jogadoresTemporariosProntos);

      const { times, reservas } = balancearJogadores(
        jogadoresTemporariosProntos,
        tamanho_time || 4
      );

      console.log('Times após balanceamento:', times);
      console.log('Reservas após balanceamento:', reservas);

      return res.status(200).json({
        message: 'Balanceamento realizado com sucesso!',
        times: times.map(time => ({
          ...time,
          jogadores: time.jogadores.map(j => ({ ...j, genero: j.genero }))
        })),
        reservas: reservas.map(r => ({ ...r, genero: r.genero }))
      });
    } catch (err) {
      console.error('Erro no balanceamento:', err);
      return res.status(500).json({
        error: 'Erro no balanceamento',
        details: err.message,
      });
    }
  }
);

/**
 * POST /api/balanceamento/finalizar-balanceamento
 * Finaliza e grava times definitivos (ONLINE).
 */
router.post(
  '/finalizar-balanceamento',
  authMiddleware,
  roleMiddleware(['organizador']),
  async (req, res) => {
    const client = await db.pool.connect();
    try {
      console.log('=== POST /api/balanceamento/finalizar-balanceamento ===');
      console.log('Body:', req.body);

      const { id_jogo, id_usuario_organizador, times } = req.body;

      if (!id_jogo || !id_usuario_organizador || !times) {
        client.release();
        return res.status(400).json({
          error: 'id_jogo, id_usuario_organizador e times são obrigatórios.',
        });
      }

      const jogoQuery = await client.query(
        `
        SELECT id_usuario, status 
          FROM jogos 
         WHERE id_jogo = $1 
         LIMIT 1
      `,
        [id_jogo]
      );

      if (jogoQuery.rowCount === 0) {
        client.release();
        return res.status(404).json({ error: 'Jogo não encontrado.' });
      }

      const { id_usuario: organizador_id, status } = jogoQuery.rows[0];

      if (parseInt(organizador_id, 10) !== parseInt(id_usuario_organizador, 10)) {
        client.release();
        return res.status(403).json({
          error: 'Somente o organizador pode finalizar o balanceamento.',
        });
      }

      if (status === 'finalizado') {
        client.release();
        return res.status(400).json({
          error: 'O jogo já está finalizado.',
        });
      }

      await client.query(
        `
        UPDATE jogos 
           SET status = 'finalizado' 
         WHERE id_jogo = $1
      `,
        [id_jogo]
      );

      await client.query('BEGIN');

      await client.query('DELETE FROM times WHERE id_jogo = $1', [id_jogo]);

      for (const [index, time] of times.entries()) {
        const numeroTime = index + 1;
        const { totalScore, totalAltura } = calcularTotais(time);

        if (!Array.isArray(time.jogadores) || time.jogadores.length === 0) {
          throw new Error(`"jogadores" deve ser um array não vazio no Time ${numeroTime}.`);
        }

        for (const jogador of time.jogadores) {
          if (!jogador.id_usuario || typeof jogador.id_usuario !== 'number') {
            throw new Error(`id_usuario inválido ou ausente para um dos jogadores no Time ${numeroTime}.`);
          }
          await client.query(
            `
            INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
            VALUES ($1, $2, $3, $4, $5)
          `,
            [id_jogo, numeroTime, jogador.id_usuario, totalScore || 0, totalAltura || 0]
          );
        }
      }

      await client.query('COMMIT');
      client.release();

      return res.status(200).json({
        message: 'Balanceamento finalizado.',
        status: 'finalizado',
        id_jogo,
        times,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      console.error('Erro ao finalizar balanceamento:', error);
      return res.status(500).json({
        error: 'Erro ao finalizar balanceamento.',
        details: error.message,
      });
    }
  }
);

/**
 * POST /api/balanceamento/atualizar-times
 * Permite sobrescrever a lista de times no DB.
 */
router.post(
  '/atualizar-times',
  authMiddleware,
  roleMiddleware(['organizador', 'jogador'], { skipIdJogo: false, optionalIdJogo: false }),
  async (req, res) => {
    const client = await db.pool.connect();
    try {
      console.log('=== POST /api/balanceamento/atualizar-times ===');
      console.log('Body:', req.body);

      const { id_jogo, times } = req.body;

      if (!id_jogo || !times || !Array.isArray(times)) {
        client.release();
        return res.status(400).json({
          error: 'id_jogo e times são obrigatórios, e times deve ser uma lista.',
        });
      }

      await client.query('BEGIN');

      const jogoQuery = await client.query(
        `
        SELECT id_jogo, status
          FROM jogos
         WHERE id_jogo = $1
         LIMIT 1
      `,
        [id_jogo]
      );
      if (jogoQuery.rowCount === 0) {
        throw new Error('Jogo não encontrado.');
      }

      await client.query('DELETE FROM times WHERE id_jogo = $1', [id_jogo]);

      for (const [index, time] of times.entries()) {
        const numeroTime = index + 1;
        const { totalScore, totalAltura } = calcularTotais(time);

        if (!Array.isArray(time.jogadores) || time.jogadores.length === 0) {
          throw new Error(`"jogadores" deve ser um array não vazio no Time ${numeroTime}.`);
        }

        for (const jogador of time.jogadores) {
          if (!jogador.id_usuario || typeof jogador.id_usuario !== 'number') {
            throw new Error(`id_usuario inválido no Time ${numeroTime}.`);
          }
          await client.query(
            `
            INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
            VALUES ($1, $2, $3, $4, $5)
          `,
            [id_jogo, numeroTime, jogador.id_usuario, totalScore || 0, totalAltura || 0]
          );
        }
      }

      await client.query('COMMIT');
      client.release();

      return res.status(200).json({
        message: 'Times atualizados com sucesso!',
        times,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      console.error('Erro ao atualizar os times:', error);
      return res.status(500).json({
        error: 'Erro ao atualizar os times.',
        details: error.message,
      });
    }
  }
);

module.exports = router;
