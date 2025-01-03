// routes/balanceamentoRoutes.js
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
  roleMiddleware(['organizador']),
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

      // Salvar os times no banco
      for (const [index, time] of times.entries()) {
        for (const jogador of time.jogadores) {
          await db.query(
            `INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              id_jogo,
              numeroTime,
              jogador.id_usuario,
              time.totalScore || 0,
              time.totalAltura || 0,
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

/**
 * POST /api/jogador/atualizar-times
 * Salva/atualiza times no banco, SEM mudar status pra finalizado.
 */
router.post(
  '/atualizar-times',
  authMiddleware,
  roleMiddleware(['organizador', 'jogador']),
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

      // Remove times antigos associados ao jogo
      await db.query(`DELETE FROM times WHERE id_jogo = $1`, [id_jogo]);

      // Insere os novos times na tabela `times`
      for (const time of times) {
        for (const jogador of time.jogadores) {
          await db.query(
            `INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
             VALUES ($1, $2, $3, $4, $5)`,
            [id_jogo, time.numero_time, jogador.id_usuario, time.totalScore || 0, time.totalAltura || 0]
          );
        }
      }

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

/**
 * OBSERVAÇÃO:
 * A rota POST /equilibrar-times foi removida para evitar duplicações.
 */

module.exports = router;
