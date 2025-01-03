// /routes/balanceamentoRoutes.js

const express = require('express');
const router = express.Router();
const db = require('../../db'); // Ajuste para o seu arquivo de conexão
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
 * ROTAS DE BALANCEAMENTO
 */

/**
 * POST /api/jogador/iniciar-balanceamento
 * Atualiza os times e mantém o jogo no estado 'andamento'.
 */
router.post(
  '/iniciar-balanceamento',
  authMiddleware,
  roleMiddleware(['organizador']),
  async (req, res) => {
    try {
      const { id_jogo, numero_times, jogadores } = req.body;
      console.log('Recebido /iniciar-balanceamento:', req.body);

      // Verificação de id_jogo
      if (!id_jogo) {
        return res.status(400).json({
          error: 'O campo id_jogo é obrigatório.',
        });
      }

      // Verificação de numero_times
      if (!numero_times || typeof numero_times !== 'number' || numero_times <= 0) {
        return res.status(400).json({
          error: 'O campo numero_times é obrigatório e deve ser um número válido.',
        });
      }

      // Verificação de jogadores
      if (!jogadores || !Array.isArray(jogadores) || jogadores.length === 0) {
        return res.status(400).json({
          error: 'O campo jogadores é obrigatório e deve ser uma lista não vazia.',
        });
      }

      console.log('Jogadores recebidos:', jogadores);

      // Buscar dados de habilidades e altura
      // Precisamos do id_usuario de cada jogador
      const listaIds = jogadores.map(j => j.id_usuario);
      console.log('Lista de IDs dos jogadores:', listaIds);

      if (listaIds.length === 0) {
        return res.status(400).json({
          error: 'Nenhum ID de jogador fornecido.',
        });
      }

      const placeholders = listaIds.map((_, i) => `$${i + 3}`).join(',');
      // Exemplo: se tivermos 5 jogadores, placeholders vira: $3, $4, $5, $6, $7

      const jogadoresQuery = await db.query(
        `
        SELECT 
          u.id_usuario, 
          u.nome, 
          COALESCE(a.passe, 1) AS passe,
          COALESCE(a.ataque, 1) AS ataque,
          COALESCE(a.levantamento, 1) AS levantamento,
          COALESCE(u.altura, 170) AS altura
        FROM usuario u
        LEFT JOIN avaliacoes a 
          ON a.usuario_id = u.id_usuario
          AND a.organizador_id = $1
        WHERE u.id_usuario IN (${placeholders})
        `,
        [req.user.id, id_jogo, ...listaIds]
      );

      console.log('Jogadores retornados pela consulta SQL:', jogadoresQuery.rows);

      if (!jogadoresQuery.rows || jogadoresQuery.rows.length === 0) {
        return res.status(400).json({
          error: 'Nenhum jogador com habilidades encontradas.',
        });
      }

      const jogadoresComHabilidades = jogadoresQuery.rows;

      // Embaralhar
      const embaralhados = embaralharJogadores(jogadoresComHabilidades);
      console.log('Jogadores embaralhados:', embaralhados);

      // Exemplo simples: vamos criar X times (numero_times) e balancear
      // Dividindo a lista embaralhada em "numero_times" times com tamanho +ou-
      const tamanhoPorTime = Math.floor(embaralhados.length / numero_times);
      const sobra = embaralhados.length % numero_times;

      const times = [];
      let inicio = 0;
      for (let i = 0; i < numero_times; i++) {
        let tamanho = tamanhoPorTime;
        if (i < sobra) tamanho += 1; // Distribui a sobra se houver
        const jogadoresDoTime = embaralhados.slice(inicio, inicio + tamanho);
        inicio += tamanho;

        const totalScore = jogadoresDoTime.reduce((sum, j) => sum + (j.passe + j.ataque + j.levantamento), 0);
        const totalAltura = jogadoresDoTime.reduce((sum, j) => sum + j.altura, 0);

        times.push({
          nome: `Time ${i + 1}`,
          jogadores: jogadoresDoTime,
          totalScore,
          totalAltura,
        });
      }

      console.log('Times após balanceamento inicial:', times);

      // Descobre se sobrou algum jogador para reserva
      // (Caso a soma do times < total de jogadores, mas a gente acima já pegou todos)
      let reservas = [];
      // Se quiser tratar explicitamente reservas, poderia filtrar aqui.

      // Calcula custo
      const custo = calcularCusto(times, 1, 1);
      console.log('Custo do balanceamento =>', custo);

      // Sugestões de rotação
      const rotacoes = gerarSugerirRotacoes(times, reservas, 2);
      console.log('Sugestões de rotações:', rotacoes);

      // Salvar no banco
      await db.query('BEGIN');

      try {
        // Remove times antigos
        await db.query('DELETE FROM times WHERE id_jogo = $1', [id_jogo]);

        // Insere cada time e seus jogadores
        for (let i = 0; i < times.length; i++) {
          const time = times[i];
          for (const jogador of time.jogadores) {
            await db.query(
              `
              INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
              VALUES ($1, $2, $3, $4, $5)
              `,
              [
                id_jogo,
                i + 1,
                jogador.id_usuario,
                time.totalScore,
                jogador.altura
              ]
            );
          }
        }

        // Atualiza jogo pra andamento (caso ainda esteja em aberto)
        const jogoAtualizadoQuery = await db.query(
          `
          UPDATE jogos
          SET status = 'andamento'
          WHERE id_jogo = $1 AND status != 'andamento'
          RETURNING status
          `,
          [id_jogo]
        );

        if (jogoAtualizadoQuery.rowCount > 0) {
          console.log(`Jogo ${id_jogo} atualizado para 'andamento'.`);
        }

        await db.query('COMMIT');
      } catch (dbError) {
        await db.query('ROLLBACK');
        console.error('Erro durante a transação de balanceamento:', dbError);
        return res.status(500).json({
          error: 'Erro ao salvar balanceamento no banco de dados.',
          details: dbError.message,
        });
      }

      return res.json({
        message: 'Balanceamento realizado com sucesso!',
        times,
        reservas,
        rotacoes,
      });
    } catch (error) {
      await db.query('ROLLBACK');
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

      if (!id_jogo || !id_usuario_organizador || !times) {
        return res.status(400).json({
          error: 'id_jogo, id_usuario_organizador e times são obrigatórios.',
        });
      }

      // Verifica se jogo existe
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
        return res.status(404).json({ error: 'Jogo não encontrado.' });
      }

      const { id_usuario: organizador_id, status } = jogoQuery.rows[0];

      if (parseInt(organizador_id, 10) !== parseInt(id_usuario_organizador, 10)) {
        return res.status(403).json({
          error: 'Somente o organizador pode finalizar o balanceamento.',
        });
      }

      if (status !== 'andamento') {
        return res.status(400).json({
          error: 'O jogo não está em estado de balanceamento.',
        });
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

      // Inicia uma transação para salvar os times
      await db.query('BEGIN');

      try {
        // Remover times existentes
        await db.query('DELETE FROM times WHERE id_jogo = $1', [id_jogo]);

        // Inserir os novos times
        for (const [index, time] of times.entries()) {
          const numeroTime = index + 1;
          // Para cada jogador
          for (const jogador of time.jogadores) {
            await db.query(
              `
              INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
              VALUES ($1, $2, $3, $4, $5)
              `,
              [
                id_jogo,
                numeroTime,
                jogador.id_usuario,
                time.totalScore || 0,
                jogador.altura || 0
              ]
            );
          }
        }

        await db.query('COMMIT');
      } catch (dbError) {
        await db.query('ROLLBACK');
        console.error('Erro durante a transação de finalização:', dbError);
        return res.status(500).json({
          error: 'Erro ao salvar balanceamento final no banco de dados.',
          details: dbError.message,
        });
      }

      return res.status(200).json({
        message: 'Balanceamento finalizado.',
        status: 'finalizado',
        id_jogo,
        times,
      });
    } catch (error) {
      await db.query('ROLLBACK');
      console.error('Erro ao finalizar balanceamento:', error);
      return res.status(500).json({
        error: 'Erro ao finalizar balanceamento.',
        details: error.message,
      });
    }
  }
);

module.exports = router;
