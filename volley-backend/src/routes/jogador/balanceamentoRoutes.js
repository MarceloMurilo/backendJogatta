// /src/features/jogo/routes/balanceamento.js

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
  const pontuacoes = times.map(t => t.totalScore);
  const alturasMedias = times.map(t =>
    t.jogadores.length > 0 ? t.totalAltura / t.jogadores.length : 0
  );
  const varPontuacao = calcularVariancia(pontuacoes);
  const varAltura = calcularVariancia(alturasMedias);
  return (pesoPontuacao * varPontuacao) + (pesoAltura * varAltura);
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
    sugeridos.sort((a, b) => a.distancia - b.distancia);
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
  for (let j of embaralhados) {
    const timeIndex = Math.floor(index / tamanhoTime);
    if (timeIndex < numTimes) {
      times[timeIndex].jogadores.push(j);
    } else {
      reservas.push(j);
    }
    index++;
  }

  times.forEach(time => {
    const { totalScore, totalAltura } = calcularTotais(time);
    time.totalScore = totalScore;
    time.totalAltura = totalAltura;
  });

  return { times, reservas };
}

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
 */
router.post(
  '/iniciar-balanceamento',
  authMiddleware,
  balancearRole,
  async (req, res) => {
    const client = await db.pool.connect();
    try {
      console.log('=== Nova requisição: POST /api/balanceamento/iniciar-balanceamento ===');
      console.log('Body:', req.body);

      const { id_jogo, tamanho_time, amigos_offline = [] } = req.body;

      // =================
      // FLUXO OFFLINE
      // =================
      if (!id_jogo) {
        // Se não recebeu nenhum jogador do front, retorna erro.
        if (!amigos_offline.length) {
          client.release();
          return res.status(400).json({
            error: 'Nenhum jogador recebido no fluxo OFFLINE.',
          });
        }

        // 1) Separar jogadores temporários e oficiais
        const jogadoresTemporarios = amigos_offline.filter(j => j.isTemp);
        const jogadoresOficiais = amigos_offline.filter(j => !j.isTemp);

        // 2) Extrair IDs de jogadores oficiais para buscar avaliações no banco
        const jogadoresOficiaisIds = jogadoresOficiais
          .map(a => a.id_usuario)
          .filter(id => typeof id === 'number');

        // 3) Buscar habilidades no DB apenas dos jogadores oficiais
        let rowsAval = [];
        if (jogadoresOficiaisIds.length > 0) {
          const avalQuery = await client.query(`
            SELECT
              u.id_usuario,
              u.nome,
              COALESCE(a.passe, 3) AS passe,
              COALESCE(a.ataque, 3) AS ataque,
              COALESCE(a.levantamento, 3) AS levantamento,
              COALESCE(u.altura, 170) AS altura
            FROM usuario u
            LEFT JOIN avaliacoes a ON a.usuario_id = u.id_usuario
            WHERE u.id_usuario = ANY($1)
          `, [jogadoresOficiaisIds]);

          rowsAval = avalQuery.rows;
        }

        // 4) Montar map para acesso rápido de avaliações dos oficiais
        const mapAval = new Map(rowsAval.map(av => [av.id_usuario, av]));

        // 5) Preparar a lista final de jogadores para balanceamento
        const jogadoresParaBalancear = [];

        // Adicionar jogadores oficiais com suas habilidades do DB
        jogadoresOficiais.forEach(frontJog => {
          const dbJog = mapAval.get(frontJog.id_usuario);
          if (dbJog) {
            jogadoresParaBalancear.push({
              id_usuario: dbJog.id_usuario,
              nome: dbJog.nome || frontJog.nome || `Jogador Temporário ${frontJog.id_usuario}`,
              passe: dbJog.passe,
              ataque: dbJog.ataque,
              levantamento: dbJog.levantamento,
              altura: parseFloat(dbJog.altura) || 170,
              temporario: false,
            });
          } else {
            // Se não encontrou no DB, usar dados do front com defaults
            jogadoresParaBalancear.push({
              id_usuario: frontJog.id_usuario,
              nome: frontJog.nome || `Jogador Temporário ${frontJog.id_usuario}`,
              passe: parseInt(frontJog.passe, 10) || 3,
              ataque: parseInt(frontJog.ataque, 10) || 3,
              levantamento: parseInt(frontJog.levantamento, 10) || 3,
              altura: parseFloat(frontJog.altura) || 170,
              temporario: false,
            });
          }
        });

        // Adicionar jogadores temporários diretamente do front
        jogadoresTemporarios.forEach(tempJog => {
          jogadoresParaBalancear.push({
            id_temporario: tempJog.id_temporario,
            nome: tempJog.nome || `Jogador Temporário ${tempJog.id_temporario}`,
            passe: parseInt(tempJog.passe, 10) || 3,
            ataque: parseInt(tempJog.ataque, 10) || 3,
            levantamento: parseInt(tempJog.levantamento, 10) || 3,
            altura: parseFloat(tempJog.altura) || 170,
            temporario: true,
          });
        });

        // 6) Balancear jogadores (sem gravar no DB)
        const { times, reservas } = balancearJogadores(jogadoresParaBalancear, tamanho_time || 4);

        // 7) Garantir que todos os jogadores tenham o nome preservado
        times.forEach(time => {
          time.jogadores.forEach(jogador => {
            if (!jogador.nome) {
              jogador.nome = jogador.temporario
                ? `Jogador Temporário ${jogador.id_temporario}`
                : `Usuário ${jogador.id_usuario}`;
            }
          });
        });

        reservas.forEach(reserva => {
          if (!reserva.nome) {
            reserva.nome = reserva.temporario
              ? `Jogador Temporário ${reserva.id_temporario}`
              : `Usuário ${reserva.id_usuario}`;
          }
        });

        // 8) Retornar o balanceamento
        client.release();
        return res.status(200).json({
          message: 'Balanceamento (OFFLINE) realizado com sucesso!',
          times,
          reservas,
        });
      }

      // =================
      // FLUXO ONLINE
      // =================
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
      if (typeof tamanho_time === 'number') {
        await client.query(`
          UPDATE jogos
             SET tamanho_time = $1
           WHERE id_jogo = $2
        `, [tamanho_time, id_jogo]);
        tamanhoTimeFinal = tamanho_time;
      }

      if (!tamanhoTimeFinal) {
        client.release();
        return res.status(200).json({
          message: 'O tamanho_time ainda não foi definido. Configure-o na tela do jogo.',
          status: 'pendente',
        });
      }

      // Buscar jogadores do DB (que participam do jogo e têm avaliação do organizador)
      const jogadoresResp = await client.query(`
        SELECT 
          u.id_usuario,
          u.nome,
          COALESCE(a.passe, 3) AS passe,
          COALESCE(a.ataque, 3) AS ataque,
          COALESCE(a.levantamento, 3) AS levantamento,
          COALESCE(u.altura, 170) AS altura
        FROM usuario u
        LEFT JOIN avaliacoes a ON a.usuario_id = u.id_usuario AND a.organizador_id = $1
        WHERE u.id_usuario IN (
          SELECT id_usuario
          FROM participacao_jogos
          WHERE id_jogo = $2
        )
      `, [req.user.id, id_jogo]);

      if (jogadoresResp.rowCount === 0) {
        client.release();
        return res.status(400).json({
          error: 'Nenhum jogador encontrado para balanceamento.',
        });
      }

      const jogadores = jogadoresResp.rows.map(j => ({
        ...j,
        altura: parseFloat(j.altura) || 0,
      }));

      // Balancear
      const { times: balancedTimes, reservas } = balancearJogadores(jogadores, tamanhoTimeFinal);
      const custo = calcularCusto(balancedTimes);
      console.log(`Custo do balanceamento: ${custo}`);

      // Garantir que todos os jogadores tenham o nome preservado
      balancedTimes.forEach(time => {
        time.jogadores.forEach(jogador => {
          if (!jogador.nome) {
            jogador.nome = jogador.temporario
              ? `Jogador Temporário ${jogador.id_temporario}`
              : `Usuário ${jogador.id_usuario}`;
          }
        });
      });

      reservas.forEach(reserva => {
        if (!reserva.nome) {
          reserva.nome = reserva.temporario
            ? `Jogador Temporário ${reserva.id_temporario}`
            : `Usuário ${reserva.id_usuario}`;
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

          await client.query(`
            INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
            VALUES ($1, $2, $3, $4, $5)
          `, [
            id_jogo,
            numeroTime,
            jogador.id_usuario,
            totalScore || 0,
            totalAltura || 0,
          ]);
        }
      }

      // Insere reservas (numero_time = 99)
      for (const reserva of reservas) {
        await client.query(`
          INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
          VALUES ($1, 99, $2, 0, $3)
        `, [id_jogo, reserva.id_usuario, reserva.altura]);
      }

      await client.query('COMMIT');
      client.release();

      return res.status(200).json({
        message: 'Balanceamento (ONLINE) realizado com sucesso!',
        times: balancedTimes,
        reservas,
      });
    }
  }
);

/**
 * POST /api/balanceamento/finalizar-balanceamento
 */
router.post(
  '/finalizar-balanceamento',
  authMiddleware,
  roleMiddleware(['organizador']),
  async (req, res) => {
    const client = await db.pool.connect();
    try {
      console.log('=== Nova requisição: POST /api/balanceamento/finalizar-balanceamento ===');
      console.log('Body:', req.body);

      const { id_jogo, id_usuario_organizador, times } = req.body;

      if (!id_jogo || !id_usuario_organizador || !times) {
        client.release();
        return res.status(400).json({
          error: 'id_jogo, id_usuario_organizador e times são obrigatórios.',
        });
      }

      const jogoQuery = await client.query(`
        SELECT id_usuario, status 
        FROM jogos 
        WHERE id_jogo = $1 
        LIMIT 1
      `, [id_jogo]);

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
      await client.query(`
        UPDATE jogos 
           SET status = 'finalizado' 
         WHERE id_jogo = $1
      `, [id_jogo]);

      await client.query('BEGIN');

      // Remover times existentes
      await client.query('DELETE FROM times WHERE id_jogo = $1', [id_jogo]);

      // Inserir os novos times
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
          await client.query(`
            INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
            VALUES ($1, $2, $3, $4, $5)
          `, [
            id_jogo,
            numeroTime,
            jogador.id_usuario,
            totalScore || 0,
            totalAltura || 0,
          ]);
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
      return res.status(500).json({
        error: 'Erro ao finalizar balanceamento.',
        details: error.message,
      });
    }
  }
);

/**
 * POST /api/balanceamento/atualizar-times
 */
router.post(
  '/atualizar-times',
  authMiddleware,
  roleMiddleware(['organizador', 'jogador'], { skipIdJogo: false, optionalIdJogo: false }),
  async (req, res) => {
    const client = await db.pool.connect();
    try {
      console.log('=== Nova requisição: POST /api/balanceamento/atualizar-times ===');
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
      const jogoQuery = await client.query(`
        SELECT id_jogo, status
        FROM jogos
        WHERE id_jogo = $1
        LIMIT 1
      `, [id_jogo]);

      if (jogoQuery.rowCount === 0) {
        throw new Error('Jogo não encontrado.');
      }

      // Remover times antigos
      await client.query('DELETE FROM times WHERE id_jogo = $1', [id_jogo]);

      // Inserir novos
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
          await client.query(`
            INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
            VALUES ($1, $2, $3, $4, $5)
          `, [
            id_jogo,
            numeroTime,
            jogador.id_usuario,
            totalScore || 0,
            totalAltura || 0,
          ]);
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
      return res.status(500).json({
        error: 'Erro ao atualizar os times.',
        details: error.message,
      });
    }
  }
);

module.exports = router;
