// /routes/balanceamentoRoutes.js

const express = require('express');
const router = express.Router();
const db = require('../../db');

// Middlewares
const authMiddleware = require('../../middlewares/authMiddleware');
const roleMiddleware = require('../../middlewares/roleMiddleware');

/**
 * Funções Utilitárias
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
  // Deduplicação de Jogadores
  const jogadoresUnicos = [...new Map(jogadores.map(j => [j.id_usuario, j])).values()];
  console.log(`Total de jogadores únicos: ${jogadoresUnicos.length}`);

  // Embaralha jogadores
  const embaralhados = embaralharJogadores([...jogadoresUnicos]);

  // Calcula quantos times teremos
  const numTimes = Math.floor(embaralhados.length / tamanhoTime);
  console.log(`Número de times a serem criados: ${numTimes}`);

  const times = [];
  for (let i = 0; i < numTimes; i++) {
    times.push({
      nomeTime: `Time ${i + 1}`,
      jogadores: [],
      totalScore: 0,
      totalAltura: 0,
    });
  }

  // Caso sobrem jogadores (reservas)
  let reservas = [];

  // Distribui jogadores
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

  console.log(`Jogadores distribuídos nos times. Total de reservas: ${reservas.length}`);

  // Calcula totalScore e totalAltura de cada time usando calcularTotais
  times.forEach(time => {
    const { totalScore, totalAltura } = calcularTotais(time);
    time.totalScore = totalScore;
    time.totalAltura = totalAltura;
  });

  console.log('Times após cálculo de pontuação e altura:', JSON.stringify(times, null, 2));

  return { times, reservas };
}

function balancearRole(req, res, next) {
  if (req.body.id_jogo) {
    // FLUXO ONLINE -> requer 'organizador'
    return roleMiddleware(['organizador'])(req, res, next);
  } else {
    // FLUXO OFFLINE -> requer 'jogador', skipIdJogo = true
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
 * - Se offline => autoriza jogador (id_jogo = null)
 * - Se online => autoriza organizador (id_jogo != null)
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

      const { id_jogo, tamanho_time } = req.body;

      // =================
      // 1) FLUXO OFFLINE
      // =================
      if (!id_jogo) {
        try {
          // Buscar jogadores para o balanceamento offline
          const jogadoresResp = await client.query(`
            SELECT 
              u.id_usuario,
              u.nome,
              COALESCE(a.passe, 3) AS passe,
              COALESCE(a.ataque, 3) AS ataque,
              COALESCE(a.levantamento, 3) AS levantamento,
              COALESCE(u.altura, 170) AS altura
            FROM usuario u
            LEFT JOIN avaliacoes a ON a.usuario_id = u.id_usuario
            LIMIT 12
          `);
          const jogadores = jogadoresResp.rows.map(jogador => ({
            ...jogador,
            altura: parseFloat(jogador.altura) || 0, // Converte altura para número
          }));

          // Deduplicação de Jogadores
          const jogadoresUnicos = [...new Map(jogadores.map(j => [j.id_usuario, j])).values()];
          console.log(`Total de jogadores únicos (OFFLINE): ${jogadoresUnicos.length}`);

          // Balancear jogadores (sem gravar no DB)
          const { times, reservas } = balancearJogadores(jogadoresUnicos, tamanho_time || 4);

          // Retorna sem salvar no BD (fluxo offline)
          return res.status(200).json({
            message: 'Balanceamento (OFFLINE) realizado com sucesso!',
            times,
            reservas,
          });
        } catch (err) {
          console.error('Erro no balanceamento OFFLINE:', err);
          return res.status(500).json({
            error: 'Erro no balanceamento OFFLINE',
            details: err.message,
          });
        } finally {
          client.release();
          console.log('Cliente de transação liberado (OFFLINE).');
        }
      }

      // =================
      // 2) FLUXO ONLINE
      // =================
      console.log(`Verificando existência do jogo com id_jogo: ${id_jogo}`);
      const jogoResp = await client.query(`
        SELECT id_jogo, id_usuario, status, tamanho_time
        FROM jogos
        WHERE id_jogo = $1
        LIMIT 1
      `, [id_jogo]);

      if (jogoResp.rowCount === 0) {
        console.error(`Erro: Jogo com id_jogo ${id_jogo} não encontrado.`);
        return res.status(404).json({
          error: 'Jogo não encontrado.',
        });
      }

      const { status, id_usuario, tamanho_time: tamanhoTimeDB } = jogoResp.rows[0];
      console.log(`Status do jogo: ${status}, Organizador ID: ${id_usuario}, Tamanho Time no DB: ${tamanhoTimeDB}`);

      // Se jogo finalizado -> não deixa prosseguir
      if (status === 'finalizado') {
        console.error('Erro: O jogo já foi finalizado.');
        return res.status(400).json({
          error: 'O jogo já foi finalizado e não pode ser balanceado novamente.',
        });
      }

      // Check de organizador
      if (id_usuario !== req.user.id) {
        console.error('Erro: Apenas o organizador do jogo pode iniciar o balanceamento.');
        return res.status(403).json({
          error: 'Apenas o organizador do jogo pode iniciar o balanceamento.',
        });
      }

      // A qualquer momento (aberto/andamento), atualiza `tamanho_time` se vier no body
      let tamanhoTimeFinal = tamanhoTimeDB;
      if (typeof tamanho_time === 'number') {
        console.log(`Atualizando tamanho_time para ${tamanho_time} (jogo não finalizado)`);
        await client.query(`
          UPDATE jogos
             SET tamanho_time = $1
           WHERE id_jogo = $2
        `, [tamanho_time, id_jogo]);
        tamanhoTimeFinal = tamanho_time;
      }

      // Se após tudo isso ainda não houver um tamanho definido, retorna aviso
      if (!tamanhoTimeFinal) {
        return res.status(200).json({
          message: 'O tamanho_time ainda não foi definido. Configure-o na tela do jogo.',
          status: 'pendente',
        });
      }

      try {
        // Busca jogadores do DB
        console.log('Buscando jogadores para balanceamento (online).');
        const jogadoresRespOnline = await client.query(`
          SELECT 
            u.id_usuario,
            u.nome,
            a.passe,
            a.ataque,
            a.levantamento,
            u.altura
          FROM usuario u
          INNER JOIN avaliacoes a ON a.usuario_id = u.id_usuario
          WHERE a.organizador_id = $1
            AND u.id_usuario IN (
              SELECT id_usuario
              FROM participacao_jogos
              WHERE id_jogo = $2
            )
        `, [req.user.id, id_jogo]);

        if (jogadoresRespOnline.rowCount === 0) {
          console.error('Erro: Nenhum jogador encontrado para balanceamento.');
          return res.status(400).json({
            error: 'Nenhum jogador encontrado para balanceamento.',
          });
        }

        const jogadoresOnline = jogadoresRespOnline.rows.map(jogador => ({
          ...jogador,
          altura: parseFloat(jogador.altura) || 0, // Converte altura para número
        }));
        console.log('Jogadores para balanceamento (online):', jogadoresOnline);

        // Balancear
        const { times: balancedTimes, reservas } = balancearJogadores(jogadoresOnline, tamanhoTimeFinal);
        const custo = calcularCusto(balancedTimes);
        console.log(`Custo do balanceamento: ${custo}`);

        // Salvar no DB
        await client.query('BEGIN');
        console.log('Transação iniciada.');

        // Apaga times antigos
        await client.query('DELETE FROM times WHERE id_jogo = $1', [id_jogo]);
        console.log('Times antigos removidos.');

        // Insere times novos usando calcularTotais
        for (const [index, time] of balancedTimes.entries()) {
          const numeroTime = index + 1;
          const { totalScore, totalAltura } = calcularTotais(time);
          console.log(`Inserindo Time ${numeroTime} com jogadores:`, JSON.stringify(time.jogadores, null, 2));

          for (const jogador of time.jogadores) {
            // Validação de id_usuario
            if (!jogador.id_usuario || typeof jogador.id_usuario !== 'number') {
              throw new Error(`id_usuario inválido ou ausente para o jogador no Time ${numeroTime}.`);
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
            console.log(`Jogador ${jogador.id_usuario} inserido no Time ${numeroTime}.`);
          }
        }

        // Insere reservas (numero_time = 99)
        for (const reserva of reservas) {
          await client.query(`
            INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
            VALUES ($1, 99, $2, 0, $3)
          `, [id_jogo, reserva.id_usuario, reserva.altura]);
          console.log(`Reserva ${reserva.id_usuario} inserida com numero_time 99.`);
        }

        // NÃO altera mais o status para 'andamento' automaticamente
        // Deixa o status como está, para que o usuário possa rebalancear várias vezes.
        // Se quiser forçar a mudança, descomente:
        // if (status === 'aberto') {
        //   await client.query(`
        //     UPDATE jogos
        //        SET status = 'andamento'
        //      WHERE id_jogo = $1
        //   `, [id_jogo]);
        // }

        await client.query('COMMIT');
        client.release();
        console.log('Transação comitada com sucesso.');
        console.log('Cliente de transação liberado (ONLINE).');

        return res.status(200).json({
          message: 'Balanceamento (ONLINE) realizado com sucesso!',
          status, // status atual do jogo no DB
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
 * Marca o status do jogo como 'finalizado'
 * Retorna times gerados (ou armazenados) para exibir ao usuário
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
      console.log(`Finalizando balanceamento para o jogo ID: ${id_jogo} pelo organizador ID: ${id_usuario_organizador}`);

      // Validações
      if (!id_jogo || !id_usuario_organizador || !times) {
        console.error('Erro: id_jogo, id_usuario_organizador e times são obrigatórios.');
        return res.status(400).json({
          error: 'id_jogo, id_usuario_organizador e times são obrigatórios.',
        });
      }

      // Verifica se o jogo existe e se o solicitante é o organizador
      console.log(`Verificando existência do jogo com id_jogo: ${id_jogo}`);
      const jogoQuery = await client.query(`
        SELECT id_usuario, status 
        FROM jogos 
        WHERE id_jogo = $1 
        LIMIT 1
      `, [id_jogo]);

      if (jogoQuery.rowCount === 0) {
        console.error('Erro: Jogo não encontrado.');
        return res.status(404).json({ error: 'Jogo não encontrado.' });
      }

      const { id_usuario: organizador_id, status } = jogoQuery.rows[0];

      if (parseInt(organizador_id, 10) !== parseInt(id_usuario_organizador, 10)) {
        console.error('Erro: Somente o organizador pode finalizar o balanceamento.');
        return res.status(403).json({
          error: 'Somente o organizador pode finalizar o balanceamento.',
        });
      }

      if (status !== 'andamento') {
        console.error('Erro: O jogo não está em estado de balanceamento.');
        return res.status(400).json({
          error: 'O jogo não está em estado de balanceamento.',
        });
      }

      // Atualiza o status do jogo para "finalizado"
      console.log('Atualizando status do jogo para "finalizado".');
      await client.query(`
        UPDATE jogos 
           SET status = 'finalizado' 
         WHERE id_jogo = $1
      `, [id_jogo]);
      console.log('Status do jogo atualizado para "finalizado".');

      try {
        // Inicia uma transação para salvar os times
        await client.query('BEGIN');
        console.log('Transação iniciada para finalizar balanceamento.');

        // Remover times existentes (caso existam)
        console.log(`Removendo times existentes para o jogo ID: ${id_jogo}`);
        await client.query('DELETE FROM times WHERE id_jogo = $1', [id_jogo]);
        console.log('Times antigos removidos.');

        // Inserir os novos times com numero_time corretamente atribuído
        for (const [index, time] of times.entries()) {
          const numeroTime = index + 1; // Define o número do time (1, 2, 3, ...)
          console.log(`\nInserindo Time ${numeroTime}:`, JSON.stringify(time, null, 2));

          if (!Array.isArray(time.jogadores) || time.jogadores.length === 0) {
            throw new Error(`"jogadores" deve ser um array não vazio no Time ${numeroTime}.`);
          }

          const { totalScore, totalAltura } = calcularTotais(time);

          for (const jogador of time.jogadores) {
            if (!jogador.id_usuario || typeof jogador.id_usuario !== 'number') {
              console.error(`Erro: Jogador inválido no Time ${numeroTime}:`, jogador);
              throw new Error(
                `id_usuario inválido ou ausente para um dos jogadores no Time ${numeroTime}.`
              );
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
            console.log(`Jogador ${jogador.id_usuario} inserido no Time ${numeroTime}.`);
          }
        }

        await client.query('COMMIT');
        console.log('Transação comitada com sucesso.');
        client.release();
        console.log('Cliente de transação liberado (finalizar-balanceamento).');

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
 * Salva/atualiza times no banco, SEM mudar status pra finalizado.
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
        console.error('Erro: id_jogo e times são obrigatórios, e times deve ser uma lista.');
        return res.status(400).json({
          error: 'id_jogo e times são obrigatórios, e times deve ser uma lista.',
        });
      }

      console.log('Times recebidos para inserção:', JSON.stringify(times, null, 2));

      try {
        // Iniciar uma transação
        await client.query('BEGIN');
        console.log('Transação iniciada.');

        // Verificar se o jogo existe
        console.log(`Verificando existência do jogo com id_jogo: ${id_jogo}`);
        const jogoQuery = await client.query(`
          SELECT id_jogo 
          FROM jogos 
          WHERE id_jogo = $1 
          LIMIT 1
        `, [id_jogo]);

        if (jogoQuery.rowCount === 0) {
          console.error('Jogo não encontrado.');
          throw new Error('Jogo não encontrado.');
        }
        console.log('Jogo verificado com sucesso:', JSON.stringify(jogoQuery.rows, null, 2));

        // Remover times existentes para o jogo
        console.log(`Removendo times existentes para o jogo ID: ${id_jogo}`);
        const deleteResult = await client.query('DELETE FROM times WHERE id_jogo = $1', [id_jogo]);
        console.log(`Resultado da consulta de DELETE: ${deleteResult.rowCount} linha(s) deletada(s).`);

        // Inserir novos times com numero_time corretamente atribuído usando calcularTotais
        console.log('Inserindo novos times no banco de dados.');
        for (const [index, time] of times.entries()) {
          const numeroTime = index + 1;
          console.log(`\nInserindo Time ${numeroTime}:`, JSON.stringify(time, null, 2));

          if (!Array.isArray(time.jogadores) || time.jogadores.length === 0) {
            throw new Error(`"jogadores" deve ser um array não vazio no Time ${numeroTime}.`);
          }

          const { totalScore, totalAltura } = calcularTotais(time);

          for (const jogador of time.jogadores) {
            if (!jogador.id_usuario || typeof jogador.id_usuario !== 'number') {
              console.error(`Erro: id_usuario inválido para um dos jogadores no Time ${numeroTime}.`, jogador);
              throw new Error(`id_usuario inválido para um dos jogadores no Time ${numeroTime}.`);
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
            console.log(`Jogador ${jogador.id_usuario} inserido no Time ${numeroTime}.`);
          }
        }

        // Commit da transação
        await client.query('COMMIT');
        console.log('Transação comitada com sucesso.');
        client.release();
        console.log('Cliente de transação liberado (atualizar-times).');

        return res.status(200).json({
          message: 'Times atualizados com sucesso!',
          times,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        client.release();
        console.error('Erro ao atualizar times:', error);
        return res.status(500).json({
          error: 'Erro ao atualizar os times.',
          details: error.message,
        });
      }
    } catch (err) {
      // Este catch cobre erros fora dos blocos internos
      await client.query('ROLLBACK');
      client.release();
      console.error('Erro geral no balanceamento:', err);
      return res.status(500).json({
        error: 'Erro geral no balanceamento.',
        details: err.message,
      });
    }
  }
);

// OBSERVAÇÃO: Rota POST /equilibrar-times removida do seu exemplo original.

module.exports = router;
