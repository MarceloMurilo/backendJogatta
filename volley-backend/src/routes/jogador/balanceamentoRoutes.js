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

const calcularCusto = (times, pesoPontuacao = 1, pesoAltura = 1) => {
  const pontuacoes = times.map((t) => t.totalScore);
  const alturasMedias = times.map((t) =>
    t.jogadores.length > 0 ? t.totalAltura / t.jogadores.length : 0
  );
  const varPontuacao = calcularVariancia(pontuacoes);
  const varAltura = calcularVariancia(alturasMedias);
  return pesoPontuacao * varPontuacao + pesoAltura * varAltura;
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
 * Função principal de balanceamento (fixando os levantadores)
 * ======================================
 *
 * Separa os jogadores fixos (levantadores) dos demais e os distribui:
 * - Os jogadores marcados como "isLevantador" serão distribuídos em round-robin,
 *   ficando fixos em seus times.
 * - Os demais jogadores serão embaralhados e alocados para completar os times.
 *
 * Modificação: Com 80% de chance, força que os jogadores "Mavis" (ex.: "Mavis 🍎") e 
 * "Dantas" (ex.: "Dantas", "Dante", "dante", "Dantas 🦝") caiam no mesmo time – inclusive
 * quando Dantas estiver como levantador.
 */
function balancearJogadores(jogadores, tamanhoTime) {
  // Separa jogadores fixos (levantadores) e flexíveis
  const fixed = jogadores.filter(j => j.isLevantador);
  const flexible = jogadores.filter(j => !j.isLevantador);

  // Funções auxiliares para identificar variantes de nomes
  const isMavisName = (nome) => nome.toLowerCase().includes("mavis");
  const isDantasName = (nome) => nome.toLowerCase().includes("dant");

  // Função para buscar jogador usando um predicado
  const getPlayerByPredicate = (predicate, arr) =>
    arr.find(j => j.nome && predicate(j.nome));

  // Busca Mavis e Dantas nos arrays fixed e flexible
  const mavisFixed = getPlayerByPredicate(isMavisName, fixed);
  const dantasFixed = getPlayerByPredicate(isDantasName, fixed);
  const mavisFlexible = getPlayerByPredicate(isMavisName, flexible);
  const dantasFlexible = getPlayerByPredicate(isDantasName, flexible);

  let mavis, dantas, mavisSource, dantasSource;
  if (mavisFixed) { mavis = mavisFixed; mavisSource = fixed; }
  else if (mavisFlexible) { mavis = mavisFlexible; mavisSource = flexible; }
  if (dantasFixed) { dantas = dantasFixed; dantasSource = fixed; }
  else if (dantasFlexible) { dantas = dantasFlexible; dantasSource = flexible; }

  // Se ambos forem encontrados e com 80% de chance, força a juntá-los
  if (mavis && dantas && Math.random() < 0.8) {
    // Se um dos dois já for fixo, força o outro a se juntar ao mesmo grupo
    if (mavisSource === fixed || dantasSource === fixed) {
      let fixedPlayer, flexiblePlayer, flexibleSource;
      if (mavisSource === fixed) {
        fixedPlayer = mavis;
        flexiblePlayer = dantas;
        flexibleSource = dantasSource;
      } else {
        fixedPlayer = dantas;
        flexiblePlayer = mavis;
        flexibleSource = mavisSource;
      }
      // Remove o jogador flexível do seu array para forçar a junção
      const index = flexibleSource.indexOf(flexiblePlayer);
      if (index > -1) {
        flexibleSource.splice(index, 1);
      }
      var forcedPair = { player1: fixedPlayer, player2: flexiblePlayer };
    } else {
      // Se ambos forem flexíveis, remova-os do array flexible
      const indexMavis = flexible.indexOf(mavis);
      if (indexMavis > -1) {
        flexible.splice(indexMavis, 1);
      }
      const indexDantas = flexible.indexOf(dantas);
      if (indexDantas > -1) {
        flexible.splice(indexDantas, 1);
      }
      var forcedPair = { player1: mavis, player2: dantas };
    }
  }

  // Atualiza a contagem total de jogadores considerando os jogadores removidos (se houver par forçado)
  const totalPlayers = fixed.length + flexible.length + (forcedPair ? 2 : 0);
  const numTimes = Math.floor(totalPlayers / tamanhoTime);

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

  // Se houver par forçado, distribui-o junto em um time que tenha espaço para os dois
  if (forcedPair) {
    const availableTeams = times.filter(time => time.jogadores.length <= tamanhoTime - 2);
    if (availableTeams.length > 0) {
      const randomIndex = Math.floor(Math.random() * availableTeams.length);
      availableTeams[randomIndex].jogadores.push(forcedPair.player1, forcedPair.player2);
    } else {
      reservas.push(forcedPair.player1, forcedPair.player2);
    }
  }

  // Distribuir os jogadores fixos (levantadores) em round-robin
  fixed.forEach((player, idx) => {
    // Se Mavis ou Dantas já foram forçados, não os reinsere
    if (forcedPair && (isMavisName(player.nome) || isDantasName(player.nome))) {
      return;
    }
    const teamIndex = idx % numTimes;
    if (times[teamIndex].jogadores.length < tamanhoTime) {
      times[teamIndex].jogadores.push(player);
    } else {
      reservas.push(player);
    }
  });

  // Embaralhar e distribuir os jogadores flexíveis
  const shuffledFlexible = embaralharJogadores([...flexible]);
  for (const player of shuffledFlexible) {
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
  }

  // Calcula totais para cada time
  times.forEach(time => {
    const { totalScore, totalAltura } = calcularTotais(time);
    time.totalScore = totalScore;
    time.totalAltura = totalAltura;
  });

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
    const client = await db.pool.connect();
    try {
      console.log('=== POST /api/balanceamento/iniciar-balanceamento ===');
      console.log('Body:', req.body);

      const { id_jogo, tamanho_time, amigos_offline = [] } = req.body;

      // FLUXO OFFLINE
      if (!id_jogo) {
        if (!amigos_offline.length) {
          client.release();
          return res.status(400).json({
            error: 'Nenhum jogador recebido no fluxo OFFLINE.',
          });
        }

        // Separa jogadores oficiais e temporários
        const offlineOficiais = amigos_offline.filter(
          (j) => typeof j.id_usuario === 'number'
        );
        const offlineTemporarios = amigos_offline.filter(
          (j) => !j.id_usuario
        );

        let rowsAval = [];
        if (offlineOficiais.length) {
          const oficiaisIds = offlineOficiais.map((j) => j.id_usuario);
          const respAval = await client.query(
            `
              SELECT
                u.id_usuario,
                u.nome,
                COALESCE(a.passe, 3) AS passe,
                COALESCE(a.ataque, 3) AS ataque,
                COALESCE(a.levantamento, 3) AS levantamento,
                COALESCE(u.altura, 170) AS altura
              FROM usuario u
              LEFT JOIN avaliacoes a 
                     ON a.usuario_id = u.id_usuario
              WHERE u.id_usuario = ANY($1)
            `,
            [oficiaisIds]
          );
          rowsAval = respAval.rows;
        }

        const mapAval = new Map(rowsAval.map((row) => [row.id_usuario, row]));

        const jogadoresOficiaisProntos = offlineOficiais.map((frontJog) => {
          const dbJog = mapAval.get(frontJog.id_usuario);
          if (dbJog) {
            return {
              ...frontJog,
              nome:
                frontJog.nome && frontJog.nome.trim() !== ''
                  ? frontJog.nome
                  : dbJog.nome || `Jogador Temporário ${frontJog.id_usuario}`,
              passe: dbJog.passe,
              ataque: dbJog.ataque,
              levantamento: dbJog.levantamento,
              altura: parseFloat(dbJog.altura) || 170,
            };
          } else {
            return {
              ...frontJog,
              nome:
                frontJog.nome && frontJog.nome.trim() !== ''
                  ? frontJog.nome
                  : `Jogador Temporário ${frontJog.id_usuario}`,
              passe: parseInt(frontJog.passe, 10) || 3,
              ataque: parseInt(frontJog.ataque, 10) || 3,
              levantamento: parseInt(frontJog.levantamento, 10) || 3,
              altura: parseFloat(frontJog.altura) || 170,
            };
          }
        });

        const jogadoresTemporariosProntos = offlineTemporarios.map((frontJog) => ({
          ...frontJog,
          nome:
            frontJog.nome && frontJog.nome.trim() !== ''
              ? frontJog.nome
              : `Jogador Temporário ${frontJog.id_temporario || frontJog.id}`,
          passe: parseInt(frontJog.passe, 10) || 3,
          ataque: parseInt(frontJog.ataque, 10) || 3,
          levantamento: parseInt(frontJog.levantamento, 10) || 3,
          altura: parseFloat(frontJog.altura) || 170,
        }));

        const todosJogadoresParaBalancear = [
          ...jogadoresOficiaisProntos,
          ...jogadoresTemporariosProntos,
        ];

        // O frontend já envia a flag isLevantador conforme seleção
        const { times, reservas } = balancearJogadores(
          todosJogadoresParaBalancear,
          tamanho_time || 4
        );

        const rotacoes = []; // Pode gerar rotações se necessário

        times.forEach((time) => {
          time.jogadores.forEach((j) => {
            if (!j.nome || !j.nome.trim()) {
              j.nome = `Jogador Temporário ${j.id_usuario || j.id}`;
            }
          });
        });
        reservas.forEach((r) => {
          if (!r.nome || !r.nome.trim()) {
            r.nome = `Jogador Temporário ${r.id_usuario || r.id}`;
          }
        });

        client.release();
        return res.status(200).json({
          message: 'Balanceamento (OFFLINE) realizado com sucesso!',
          times,
          reservas,
          rotacoes,
        });
      }

      // FLUXO ONLINE
      console.log(`Verificando existência do jogo com id_jogo: ${id_jogo}`);
      const jogoResp = await client.query(
        `
        SELECT id_jogo, id_usuario, status, tamanho_time
          FROM jogos
         WHERE id_jogo = $1
         LIMIT 1
      `,
        [id_jogo]
      );

      if (jogoResp.rowCount === 0) {
        client.release();
        return res.status(404).json({
          error: 'Jogo não encontrado.',
        });
      }

      const { status, id_usuario, tamanho_time: tamanhoTimeDB } = jogoResp.rows[0];

      if (status === 'finalizado') {
        client.release();
        return res.status(400).json({
          error: 'O jogo já foi finalizado e não pode ser balanceado novamente.',
        });
      }

      if (id_usuario !== req.user.id) {
        client.release();
        return res.status(403).json({
          error: 'Apenas o organizador do jogo pode iniciar o balanceamento.',
        });
      }

      let tamanhoTimeFinal = tamanhoTimeDB;
      if (typeof tamanho_time === 'number') {
        await client.query(
          `
          UPDATE jogos
             SET tamanho_time = $1
           WHERE id_jogo = $2
        `,
          [tamanho_time, id_jogo]
        );
        tamanhoTimeFinal = tamanho_time;
      }

      if (!tamanhoTimeFinal) {
        client.release();
        return res.status(200).json({
          message: 'O tamanho_time ainda não foi definido. Configure-o na tela do jogo.',
          status: 'pendente',
        });
      }

      const jogadoresResp = await client.query(
        `
        SELECT 
          u.id_usuario,
          u.nome,
          COALESCE(a.passe, 3) AS passe,
          COALESCE(a.ataque, 3) AS ataque,
          COALESCE(a.levantamento, 3) AS levantamento,
          COALESCE(u.altura, 170) AS altura
        FROM usuario u
        LEFT JOIN avaliacoes a 
               ON a.usuario_id = u.id_usuario 
              AND a.organizador_id = $1
        WHERE u.id_usuario IN (
          SELECT id_usuario
            FROM participacao_jogos
           WHERE id_jogo = $2
        )
      `,
        [req.user.id, id_jogo]
      );

      if (jogadoresResp.rowCount === 0) {
        client.release();
        return res.status(400).json({
          error: 'Nenhum jogador encontrado para balanceamento.',
        });
      }

      const jogadores = jogadoresResp.rows.map((j) => ({
        ...j,
        altura: parseFloat(j.altura) || 0,
      }));

      // O frontend envia a flag isLevantador conforme seleção.
      // Assim, fixamos os levantadores e balanceamos os demais.
      const { times: balancedTimes, reservas } = balancearJogadores(
        jogadores,
        tamanhoTimeFinal
      );
      const custo = calcularCusto(balancedTimes);
      console.log(`Custo do balanceamento: ${custo}`);

      const rotacoes = []; // Pode gerar rotações se necessário

      balancedTimes.forEach((time) => {
        time.jogadores.forEach((jogador) => {
          if (!jogador.nome) {
            jogador.nome = `Jogador Temporário ${jogador.id_usuario}`;
          }
        });
      });
      reservas.forEach((reserva) => {
        if (!reserva.nome) {
          reserva.nome = `Jogador Temporário ${reserva.id_usuario}`;
        }
      });

      // Salvar no DB
      await client.query('BEGIN');

      await client.query('DELETE FROM times WHERE id_jogo = $1', [id_jogo]);

      for (const [index, time] of balancedTimes.entries()) {
        const numeroTime = index + 1;
        const { totalScore, totalAltura } = calcularTotais(time);

        for (const jogador of time.jogadores) {
          if (!jogador.id_usuario || typeof jogador.id_usuario !== 'number') {
            throw new Error(`id_usuario inválido no Time ${numeroTime}.`);
          }

          await client.query(
            `
            INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
            VALUES ($1, $2, $3, $4, $5)
          `,
            [
              id_jogo,
              numeroTime,
              jogador.id_usuario,
              totalScore || 0,
              totalAltura || 0,
            ]
          );
        }
      }

      for (const reserva of reservas) {
        await client.query(
          `
          INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
          VALUES ($1, 99, $2, 0, $3)
        `,
          [id_jogo, reserva.id_usuario, reserva.altura]
        );
      }

      await client.query('COMMIT');
      client.release();

      return res.status(200).json({
        message: 'Balanceamento (ONLINE) realizado com sucesso!',
        status,
        times: balancedTimes,
        reservas,
        rotacoes,
      });
    } catch (err) {
      console.error('Erro ao iniciar balanceamento:', err);
      await client.query('ROLLBACK');
      client.release();
      return res.status(500).json({
        error: 'Erro ao iniciar balanceamento',
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
            throw new Error(
              `id_usuario inválido ou ausente para um dos jogadores no Time ${numeroTime}.`
            );
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
