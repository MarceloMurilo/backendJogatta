// /routes/balanceamentoRoutes.js

const express = require('express');
const router = express.Router();
const db = require('../../db'); // Conexão com o banco de dados
const authMiddleware = require('../../middlewares/authMiddleware');
const roleMiddleware = require('../../middlewares/roleMiddleware');

/**
 * Funções Utilitárias
 */

/**
 * Embaralha uma lista de jogadores usando o algoritmo Fisher-Yates
 * @param {Array} jogadores - Lista de jogadores
 * @returns {Array} - Lista embaralhada
 */
const embaralharJogadores = (jogadores) => {
  for (let i = jogadores.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [jogadores[i], jogadores[j]] = [jogadores[j], jogadores[i]];
  }
  return jogadores;
};

/**
 * Calcula a variância de um conjunto de valores
 * @param {Array} valores - Lista de valores numéricos
 * @returns {number} - Variância
 */
const calcularVariancia = (valores) => {
  if (valores.length === 0) return 0;
  const media = valores.reduce((sum, v) => sum + v, 0) / valores.length;
  return valores.reduce((sum, v) => sum + Math.pow(v - media, 2), 0) / valores.length;
};

/**
 * Calcula o custo baseado na variância das pontuações e alturas dos times
 * @param {Array} times - Lista de times
 * @param {number} pesoPontuacao - Peso para a variância das pontuações
 * @param {number} pesoAltura - Peso para a variância das alturas
 * @returns {number} - Custo total
 */
const calcularCusto = (times, pesoPontuacao = 1, pesoAltura = 1) => {
  const pontuacoes = times.map(t => t.totalScore);
  const alturasMedias = times.map(t =>
    t.jogadores.length > 0 ? t.totalAltura / t.jogadores.length : 0
  );
  const varPontuacao = calcularVariancia(pontuacoes);
  const varAltura = calcularVariancia(alturasMedias);

  return (pesoPontuacao * varPontuacao) + (pesoAltura * varAltura);
};

/**
 * Calcula a distância euclidiana entre dois jogadores
 * @param {Object} jogador1 - Primeiro jogador
 * @param {Object} jogador2 - Segundo jogador
 * @returns {number} - Distância euclidiana
 */
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
 * Gera sugestões de rotações de jogadores reservas para os times
 * @param {Array} times - Lista de times
 * @param {Array} reservas - Lista de jogadores reservas
 * @param {number} topN - Número de sugestões por reserva
 * @returns {Array} - Sugestões de rotações
 */
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

/**
 * Rotas de Balanceamento
 */

/**
 * POST /api/jogador/iniciar-balanceamento
 * Inicia o balanceamento com base no número de times fornecido.
 */
router.post(
  '/iniciar-balanceamento',
  authMiddleware,
  roleMiddleware(['organizador']),
  async (req, res) => {
    try {
      const { id_jogo, numero_times, pesoPontuacao = 1, pesoAltura = 1 } = req.body; // Adiciona pesoPontuacao e pesoAltura
      console.log(`[Balanceamento] [id_jogo: ${id_jogo}] Recebido /iniciar-balanceamento:`, req.body);

      if (!id_jogo || !numero_times) {
        console.error(`[Balanceamento] [id_jogo: ${id_jogo}] Erro: Campos id_jogo e numero_times são obrigatórios.`);
        return res.status(400).json({
          error: 'Os campos id_jogo e numero_times são obrigatórios.',
        });
      }

      // Validação: numero_times deve ser um número inteiro positivo
      if (!Number.isInteger(numero_times) || numero_times < 1) {
        console.error(`[Balanceamento] [id_jogo: ${id_jogo}] Erro: numero_times deve ser um número inteiro positivo.`);
        return res.status(400).json({
          error: 'numero_times deve ser um número inteiro positivo.',
        });
      }

      // Definir o mínimo de jogadores por time
      const min_jogadores_por_time = 2;

      // Busca os jogadores participantes do jogo
      const jogadoresQuery = await db.query(
        `
        SELECT 
          u.id_usuario, 
          u.nome, 
          a.passe, 
          a.ataque, 
          a.levantamento, 
          u.altura 
        FROM usuario u
        INNER JOIN avaliacoes a 
          ON a.usuario_id = u.id_usuario
        WHERE a.organizador_id = $1 
          AND a.usuario_id IN (
            SELECT id_usuario 
            FROM participacao_jogos 
            WHERE id_jogo = $2
          )
        `,
        [req.user.id, id_jogo]
      );

      if (jogadoresQuery.rowCount === 0) {
        console.error(`[Balanceamento] [id_jogo: ${id_jogo}] Erro: Nenhum jogador encontrado para balanceamento.`);
        return res.status(400).json({
          error: 'Nenhum jogador encontrado para balanceamento.',
        });
      }

      const jogadores = jogadoresQuery.rows;

      // Verifica se há jogadores suficientes para o número de times solicitados
      if (jogadores.length < numero_times * min_jogadores_por_time) {
        console.error(`[Balanceamento] [id_jogo: ${id_jogo}] Erro: Jogadores insuficientes para o balanceamento solicitado.`);
        return res.status(400).json({
          error: `É necessário pelo menos ${numero_times * min_jogadores_por_time} jogadores para formar ${numero_times} times, com no mínimo ${min_jogadores_por_time} jogadores por time.`,
        });
      }

      // Balanceia os jogadores em `numero_times`
      const embaralhados = embaralharJogadores(jogadores);
      const times = Array.from({ length: numero_times }, (_, index) => ({
        nome: `Time ${index + 1}`,
        jogadores: [],
        totalScore: 0,
        totalAltura: 0,
      }));

      embaralhados.forEach((jogador, index) => {
        const timeIndex = index % numero_times;
        times[timeIndex].jogadores.push(jogador);
      });

      // Calcula totalScore e totalAltura para cada time
      times.forEach((time) => {
        time.totalScore = time.jogadores.reduce(
          (sum, jogador) => sum + (jogador.passe + jogador.ataque + jogador.levantamento),
          0
        );
        time.totalAltura = time.jogadores.reduce((sum, jogador) => sum + jogador.altura, 0);
      });

      // Calcula o custo do balanceamento
      const custo = calcularCusto(times, pesoPontuacao, pesoAltura);
      console.log(`[Balanceamento] [id_jogo: ${id_jogo}] Custo do balanceamento: ${custo}`);

      // Inicia uma transação para atualizar os times no banco
      await db.query('BEGIN');
      console.log(`[Balanceamento] [id_jogo: ${id_jogo}] Transação iniciada.`);

      // Remove times antigos
      const deleteResult = await db.query('DELETE FROM times WHERE id_jogo = $1', [id_jogo]);
      console.log(`[Balanceamento] [id_jogo: ${id_jogo}] Resultado da consulta de DELETE: ${deleteResult.rowCount} linha(s) deletada(s).`);

      // Insere os novos times
      for (const [index, time] of times.entries()) {
        const numeroTime = index + 1;
        for (const jogador of time.jogadores) {
          await db.query(
            `
            INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [id_jogo, numeroTime, jogador.id_usuario, time.totalScore, jogador.altura]
          );
        }
      }

      // Calcula o custo e possivelmente ajusta novamente (opcional)
      // ...

      // Atualiza o status para 'andamento' (se ainda não for)
      await db.query(
        `
        UPDATE jogos 
        SET status = 'andamento' 
        WHERE id_jogo = $1
        `,
        [id_jogo]
      );
      console.log(`[Balanceamento] [id_jogo: ${id_jogo}] Status do jogo atualizado para 'andamento'.`);

      await db.query('COMMIT');
      console.log(`[Balanceamento] [id_jogo: ${id_jogo}] Transação comitada com sucesso.`);

      return res.status(200).json({
        message: 'Balanceamento realizado com sucesso!',
        status: 'andamento',
        times,
      });
    } catch (error) {
      await db.query('ROLLBACK');
      console.error(`[Balanceamento] [id_jogo: ${req.body.id_jogo}] Erro ao iniciar balanceamento:`, error);
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
  roleMiddleware(['organizador']),
  async (req, res) => {
    try {
      const { id_jogo, id_usuario_organizador, times } = req.body;
      console.log(`[Finalizar Balanceamento] [id_jogo: ${id_jogo}] Recebido /finalizar-balanceamento:`, req.body);

      // Validações
      if (!id_jogo || !id_usuario_organizador || !times) {
        console.error(`[Finalizar Balanceamento] [id_jogo: ${id_jogo}] Erro: id_jogo, id_usuario_organizador e times são obrigatórios.`);
        return res.status(400).json({
          error: 'id_jogo, id_usuario_organizador e times são obrigatórios.',
        });
      }

      // Verifica se o jogo existe e se o solicitante é o organizador
      const jogoQuery = await db.query(
        `
        SELECT id_usuario, status 
        FROM jogos 
        WHERE id_jogo = $1 
        LIMIT 1
        `,
        [id_jogo]
      );

      if (jogoQuery.rowCount === 0) {
        console.error(`[Finalizar Balanceamento] [id_jogo: ${id_jogo}] Erro: Jogo não encontrado.`);
        return res.status(404).json({ error: 'Jogo não encontrado.' });
      }

      const { id_usuario: organizador_id, status } = jogoQuery.rows[0];

      if (parseInt(organizador_id, 10) !== parseInt(id_usuario_organizador, 10)) {
        console.error(`[Finalizar Balanceamento] [id_jogo: ${id_jogo}] Erro: Apenas o organizador pode finalizar o balanceamento.`);
        return res.status(403).json({
          error: 'Somente o organizador pode finalizar o balanceamento.',
        });
      }

      if (status !== 'andamento') {
        console.error(`[Finalizar Balanceamento] [id_jogo: ${id_jogo}] Erro: O jogo não está em estado de balanceamento.`);
        return res.status(400).json({
          error: 'O jogo não está em estado de balanceamento.',
        });
      }

      // Inicia uma transação para salvar os times
      await db.query('BEGIN');
      console.log(`[Finalizar Balanceamento] [id_jogo: ${id_jogo}] Transação iniciada para finalizar balanceamento.`);

      // Remover times existentes (caso existam)
      const deleteResult = await db.query('DELETE FROM times WHERE id_jogo = $1', [id_jogo]);
      console.log(`[Finalizar Balanceamento] [id_jogo: ${id_jogo}] Times antigos removidos: ${deleteResult.rowCount} linha(s).`);

      // Inserir os novos times com numero_time corretamente atribuído
      for (const [index, time] of times.entries()) {
        const numeroTime = index + 1;
        console.log(`[Finalizar Balanceamento] [id_jogo: ${id_jogo}] Inserindo Time ${numeroTime}:`, JSON.stringify(time, null, 2));

        // Verificar se 'jogadores' é um array válido
        if (!Array.isArray(time.jogadores) || time.jogadores.length === 0) {
          throw new Error(`"jogadores" deve ser um array não vazio no Time ${numeroTime}.`);
        }

        for (const jogador of time.jogadores) {
          // Validar se 'id_usuario' está presente e é um número
          if (!jogador.id_usuario || typeof jogador.id_usuario !== 'number') {
            console.error(`[Finalizar Balanceamento] [id_jogo: ${id_jogo}] Erro: Jogador inválido no Time ${numeroTime}:`, jogador);
            throw new Error(`id_usuario inválido ou ausente para um dos jogadores no Time ${numeroTime}.`);
          }

          console.log(`[Finalizar Balanceamento] [id_jogo: ${id_jogo}] Inserindo Jogador ID: ${jogador.id_usuario}, Time: ${numeroTime}`);

          // Inserir o jogador no time
          await db.query(
            `
            INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [
              id_jogo,
              numeroTime, // Use o número do time aqui
              jogador.id_usuario,
              time.totalScore || 0,
              jogador.altura || 0, // Garantindo altura válida
            ]
          );

          console.log(`[Finalizar Balanceamento] [id_jogo: ${id_jogo}] Jogador ${jogador.id_usuario} inserido no Time ${numeroTime}.`);
        }
      }

      // Atualiza o status do jogo para "finalizado"
      await db.query(
        `
        UPDATE jogos 
        SET status = 'finalizado' 
        WHERE id_jogo = $1
        `,
        [id_jogo]
      );
      console.log(`[Finalizar Balanceamento] [id_jogo: ${id_jogo}] Status do jogo atualizado para 'finalizado'.`);

      // Commit da transação
      await db.query('COMMIT');
      console.log(`[Finalizar Balanceamento] [id_jogo: ${id_jogo}] Transação comitada com sucesso.`);

      return res.status(200).json({
        message: 'Balanceamento finalizado.',
        status: 'finalizado',
        id_jogo,
        times,
      });
    } catch (error) {
      // Rollback em caso de erro
      await db.query('ROLLBACK');
      console.error(`[Finalizar Balanceamento] [id_jogo: ${req.body.id_jogo}] Erro ao finalizar balanceamento:`, error);
      return res.status(500).json({
        error: 'Erro ao finalizar balanceamento.',
        details: error.message,
      });
    }
  }
);

/**
 * POST /api/jogador/atualizar-times
 * Salva/atualiza times no banco, SEM mudar status pra finalizado.
 */
router.post(
  '/atualizar-times',
  authMiddleware,
  roleMiddleware(['organizador', 'jogador'], { skipIdJogo: false, optionalIdJogo: false }),
  async (req, res) => {
    try {
      const { id_jogo, times } = req.body;

      console.log(`[Atualizar Times] [id_jogo: ${id_jogo}] Nova requisição recebida para atualizar times.`);
      console.log(`[Atualizar Times] [id_jogo: ${id_jogo}] Body:`, JSON.stringify(req.body, null, 2));

      // Validação dos parâmetros
      if (!id_jogo || !times || !Array.isArray(times)) {
        console.error(`[Atualizar Times] [id_jogo: ${id_jogo}] Erro: id_jogo e times são obrigatórios, e times deve ser uma lista.`);
        return res.status(400).json({
          error: 'id_jogo e times são obrigatórios, e times deve ser uma lista.',
        });
      }

      console.log(`[Atualizar Times] [id_jogo: ${id_jogo}] Times recebidos para inserção:`, JSON.stringify(times, null, 2));

      // Iniciar uma transação
      await db.query('BEGIN');
      console.log(`[Atualizar Times] [id_jogo: ${id_jogo}] Transação iniciada.`);

      // Verificar se o jogo existe
      const jogoQuery = await db.query(
        `
        SELECT id_jogo 
        FROM jogos 
        WHERE id_jogo = $1 
        LIMIT 1
        `,
        [id_jogo]
      );
      if (jogoQuery.rowCount === 0) {
        throw new Error('Jogo não encontrado.');
      }
      console.log(`[Atualizar Times] [id_jogo: ${id_jogo}] Resultado da consulta de jogo:`, JSON.stringify(jogoQuery.rows, null, 2));

      // Remover times existentes para o jogo
      const deleteResult = await db.query('DELETE FROM times WHERE id_jogo = $1', [id_jogo]);
      console.log(`[Atualizar Times] [id_jogo: ${id_jogo}] Resultado da consulta de DELETE: ${deleteResult.rowCount} linha(s) deletada(s).`);

      // Inserir novos times com numero_time corretamente atribuído
      for (const [index, time] of times.entries()) {
        const numeroTime = index + 1; // Define o número do time (1, 2, 3, ...)
        console.log(`[Atualizar Times] [id_jogo: ${id_jogo}] Inserindo Time ${numeroTime}:`, JSON.stringify(time, null, 2));

        // Verificar se 'jogadores' é um array válido
        if (!Array.isArray(time.jogadores) || time.jogadores.length === 0) {
          throw new Error(`"jogadores" deve ser um array não vazio no Time ${numeroTime}.`);
        }

        for (const jogador of time.jogadores) {
          // Validar se 'id_usuario' está presente e é um número
          if (!jogador.id_usuario || typeof jogador.id_usuario !== 'number') {
            console.error(`[Atualizar Times] [id_jogo: ${id_jogo}] Erro: Jogador inválido no Time ${numeroTime}:`, jogador);
            throw new Error(`id_usuario inválido ou ausente para um dos jogadores no Time ${numeroTime}.`);
          }

          console.log(`[Atualizar Times] [id_jogo: ${id_jogo}] Inserindo Jogador ID: ${jogador.id_usuario}, Time: ${numeroTime}`);

          // Inserir o jogador no time
          await db.query(
            `
            INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [
              id_jogo,
              numeroTime, // Use o número do time aqui
              jogador.id_usuario,
              time.totalScore || 0,
              jogador.altura || 0, // Garantindo altura válida
            ]
          );

          console.log(`[Atualizar Times] [id_jogo: ${id_jogo}] Jogador ${jogador.id_usuario} inserido no Time ${numeroTime}.`);
        }
      }

      // Commit da transação
      await db.query('COMMIT');
      console.log(`[Atualizar Times] [id_jogo: ${id_jogo}] Transação comitada com sucesso.`);

      return res.status(200).json({
        message: 'Times atualizados com sucesso!',
        times,
      });
    } catch (error) {
      // Rollback em caso de erro
      await db.query('ROLLBACK');
      console.error(`[Atualizar Times] [id_jogo: ${req.body.id_jogo}] Erro ao atualizar times:`, error);
      return res.status(500).json({
        error: 'Erro ao atualizar os times.',
        details: error.message,
      });
    }
  }
);

/**
 * OBSERVAÇÃO:
 * A rota POST /equilibrar-times foi removida para evitar duplicações.
 */

module.exports = router;
