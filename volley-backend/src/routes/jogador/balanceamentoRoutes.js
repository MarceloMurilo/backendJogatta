// /routes/jogador/balanceamentoRoutes.js

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
 * Exemplo de sugestão de substituições
 */
const gerarSugerirRotacoes = (times, reservas, topN = 2) => {
  const rotacoes = [];
  reservas.forEach((reserva) => {
    const sugeridos = [];
    times.forEach((time, timeIndex) => {
      time.jogadores.forEach((jogador) => {
        const distancia = calcularDistancia(reserva, jogador);
        sugeridos.push({
          time: timeIndex + 1,
          jogador,
          distancia,
        });
      });
    });
    sugeridos.sort((a, b) => a.distancia - b.distancia);
    const topSugeridos = sugeridos.slice(0, topN).map((s) => ({
      time: s.time,
      jogador: s.jogador,
      distancia: s.distancia.toFixed(2),
    }));
    rotacoes.push({
      reserva,
      sugeridos: topSugeridos,
    });
  });
  return rotacoes;
};

/**
 * Função principal de balanceamento (embaralha e distribui).
 */
function balancearJogadores(jogadores, tamanhoTime) {
  const embaralhados = embaralharJogadores([...jogadores]);

  const numTimes = Math.floor(embaralhados.length / tamanhoTime);

  const times = [];
  for (let i = 0; i < numTimes; i++) {
    times.push({
      nomeTime: `Time ${i + 1}`,
      jogadores: [],
      totalScore: 0,
      totalAltura: 0,
    });
  }

  let reservas = [];
  let index = 0;
  for (const j of embaralhados) {
    const timeIndex = Math.floor(index / tamanhoTime);
    if (timeIndex < numTimes) {
      times[timeIndex].jogadores.push(j);
    } else {
      reservas.push(j);
    }
    index++;
  }

  // Calcula totalScore e totalAltura de cada time
  times.forEach((time) => {
    const { totalScore, totalAltura } = calcularTotais(time);
    time.totalScore = totalScore;
    time.totalAltura = totalAltura;
  });

  return { times, reservas };
}

/**
 * Verifica a role:
 * - Se tiver id_jogo no body, exige "organizador".
 * - Se não tiver (offline), exige "jogador".
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
 * - Se for OFFLINE (sem id_jogo): 
 *      Recebe `amigos_offline` e realiza balanceamento sem gravar no DB,
 *      mantendo o nome do jogador temporário conforme digitado no front.
 * - Se for ONLINE (com id_jogo): 
 *      Verifica o jogo, busca jogadores do DB e grava times no DB.
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

      // ==========================
      // FLUXO OFFLINE (id_jogo == null)
      // ==========================
      if (!id_jogo) {
        if (!amigos_offline.length) {
          client.release();
          return res.status(400).json({
            error: 'Nenhum jogador recebido no fluxo OFFLINE.',
          });
        }

        // Filtra os jogadores que têm id_usuario (oficiais)
        const offlineOficiais = amigos_offline.filter(
          (j) => typeof j.id_usuario === 'number'
        );

        // Filtra jogadores que têm apenas id_temporario ou algo assim
        const offlineTemporarios = amigos_offline.filter(
          (j) => !j.id_usuario
        );

        // Buscar no DB apenas se tiver jogadores oficiais
        let rowsAval = [];
        if (offlineOficiais.length) {
          const oficiaisIds = offlineOficiais.map((j) => j.id_usuario);
          // Buscar no DB (usuario + avaliacoes) para sobrescrever stats
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

        // Montar map <id_usuario, dados do DB>
        const mapAval = new Map(rowsAval.map((row) => [row.id_usuario, row]));

        // Processar jogadores oficiais
        const jogadoresOficiaisProntos = offlineOficiais.map((frontJog) => {
          const dbJog = mapAval.get(frontJog.id_usuario);
          if (dbJog) {
            // Se achou no BD, mescla, mas não sobrescreve "frontJog.nome" se vier preenchido
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
            // Não achou no BD -> é "oficial" mas sem dados, ou algo do tipo
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

        // Processar jogadores temporários (sem id_usuario)
        // Mantém EXACTAMENTE o frontJog.nome se não estiver vazio
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

        // Junta todos
        const todosJogadoresParaBalancear = [
          ...jogadoresOficiaisProntos,
          ...jogadoresTemporariosProntos,
        ];

        // Balancear
        const { times, reservas } = balancearJogadores(
          todosJogadoresParaBalancear,
          tamanho_time || 4
        );

        // Se ainda houver algum jogador sem nome, definir fallback
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
        });
      }

      // ==========================
      // FLUXO ONLINE (id_jogo existe)
      // ==========================
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

      // Se jogo finalizado
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

      // Buscar jogadores do DB (participantes do jogo + avaliações do organizador)
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

      // Executa balanceamento
      const { times: balancedTimes, reservas } = balancearJogadores(
        jogadores,
        tamanhoTimeFinal
      );
      const custo = calcularCusto(balancedTimes);
      console.log(`Custo do balanceamento: ${custo}`);

      // Ajusta nomes se estiverem vazios
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

      // Apaga times antigos
      await client.query('DELETE FROM times WHERE id_jogo = $1', [id_jogo]);

      // Insere times
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

      // Insere reservas (numero_time = 99)
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
      });
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      console.error('Erro ao iniciar balanceamento:', err);
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

      // Atualiza o status do jogo para "finalizado"
      await client.query(
        `
        UPDATE jogos 
           SET status = 'finalizado' 
         WHERE id_jogo = $1
      `,
        [id_jogo]
      );

      await client.query('BEGIN');

      // Remove times existentes
      await client.query('DELETE FROM times WHERE id_jogo = $1', [id_jogo]);

      // Inserir novos times
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
 * (ONLINE) Permite sobrescrever a lista de times no DB.
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

      // Verifica jogo
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

      // Remove times antigos
      await client.query('DELETE FROM times WHERE id_jogo = $1', [id_jogo]);

      // Insere novos
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
