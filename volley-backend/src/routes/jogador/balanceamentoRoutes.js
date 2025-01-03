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
  console.log('Iniciando embaralhamento dos jogadores.');
  for (let i = jogadores.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [jogadores[i], jogadores[j]] = [jogadores[j], jogadores[i]];
  }
  console.log('Embaralhamento concluído.');
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
  console.log('Calculando custo do balanceamento.');
  const pontuacoes = times.map(t => t.totalScore);
  const alturasMedias = times.map(t =>
    t.jogadores.length > 0 ? t.totalAltura / t.jogadores.length : 0
  );
  const varPontuacao = calcularVariancia(pontuacoes);
  const varAltura = calcularVariancia(alturasMedias);

  const custo = (pesoPontuacao * varPontuacao) + (pesoAltura * varAltura);
  console.log(`Variância das Pontuações: ${varPontuacao}, Variância das Alturas: ${varAltura}`);
  console.log(`Custo total do balanceamento: ${custo}`);
  return custo;
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
  console.log('Gerando sugestões de rotações para reservas.');
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

  console.log('Sugestões de rotações geradas:', JSON.stringify(rotacoes, null, 2));
  return rotacoes;
};

/**
 * Função principal de balanceamento respeitando o tamanho_time
 * Retorna um objeto com { times, reservas }.
 */
function balancearJogadores(jogadores, tamanhoTime) {
  console.log('Iniciando função de balanceamento de jogadores.');
  // Embaralha jogadores
  const embaralhados = embaralharJogadores([...jogadores]);

  // Calcula quantos times teremos
  const numTimes = Math.floor(embaralhados.length / tamanhoTime);
  console.log(`Número de times a serem criados: ${numTimes}`);

  const times = [];
  for (let i = 0; i < numTimes; i++) {
    times.push({
      nome: `Time ${i + 1}`,
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

  // Calcula totalScore e totalAltura de cada time
  times.forEach(time => {
    time.totalScore = time.jogadores.reduce(
      (sum, jogador) => sum + (jogador.passe + jogador.ataque + jogador.levantamento),
      0
    );
    time.totalAltura = time.jogadores.reduce((sum, jogador) => sum + jogador.altura, 0);
  });

  console.log('Times após cálculo de pontuação e altura:', JSON.stringify(times, null, 2));

  return { times, reservas };
}

/**
 * Rotas de Balanceamento
 */

/**
 * POST /api/jogador/iniciar-balanceamento
 * Atualiza os times e mantém o jogo no estado 'andamento'.
 * Se for a primeira vez (status 'aberto'), recebemos e salvamos tamanho_time no jogo.
 * Se já estiver em andamento, apenas reutilizamos o tamanho_time do banco.
 */
router.post(
  '/iniciar-balanceamento',
  authMiddleware,
  roleMiddleware(['organizador']),
  async (req, res) => {
    const client = await db.getClient();
    try {
      console.log('=== Nova requisição recebida ===');
      console.log('Método: POST');
      console.log('URL: /api/jogador/iniciar-balanceamento');
      console.log('Body:', JSON.stringify(req.body, null, 2));
      console.log('===============================');

      const { id_jogo, tamanho_time } = req.body; // tamanho_time pode vir ou não

      if (!id_jogo) {
        console.error('Erro: O campo id_jogo é obrigatório.');
        return res.status(400).json({
          error: 'O campo id_jogo é obrigatório.',
        });
      }

      // Verifica se o jogo existe
      console.log(`Verificando existência do jogo com id_jogo: ${id_jogo}`);
      const jogoQuery = await client.query(
        `
          SELECT id_jogo, id_usuario, status, tamanho_time
          FROM jogos 
          WHERE id_jogo = $1 
          LIMIT 1
        `,
        [id_jogo]
      );

      if (jogoQuery.rowCount === 0) {
        console.error(`Erro: Jogo com id_jogo ${id_jogo} não encontrado.`);
        return res.status(404).json({
          error: 'Jogo não encontrado.',
        });
      }

      const {
        status,
        id_usuario: organizador_id,
        tamanho_time: tamanhoTimeDB,
      } = jogoQuery.rows[0];

      console.log(`Status do jogo: ${status}, Organizador ID: ${organizador_id}, Tamanho Time no DB: ${tamanhoTimeDB}`);

      // Se o jogo já estiver finalizado, bloqueia
      if (status === 'finalizado') {
        console.error('Erro: O jogo já foi finalizado.');
        return res.status(400).json({
          error: 'O jogo já foi finalizado.',
        });
      }

      // Verifica se o usuário é o organizador
      if (organizador_id !== req.user.id) {
        console.error('Erro: Apenas o organizador do jogo pode iniciar o balanceamento.');
        return res.status(403).json({
          error: 'Apenas o organizador do jogo pode iniciar o balanceamento.',
        });
      }

      // Se o jogo estiver 'aberto', podemos atualizar o tamanho_time no BD
      let tamanhoTimeFinal = tamanhoTimeDB;
      if (status === 'aberto') {
        if (!tamanho_time) {
          console.error('Erro: tamanho_time é obrigatório quando o jogo ainda está em aberto.');
          return res.status(400).json({
            error: 'tamanho_time é obrigatório quando o jogo ainda está em aberto.',
          });
        }
        // Atualiza o tamanho_time na tabela jogos
        console.log(`Atualizando tamanho_time para ${tamanho_time}`);
        await client.query(
          `UPDATE jogos SET tamanho_time = $1 WHERE id_jogo = $2`,
          [tamanho_time, id_jogo]
        );
        tamanhoTimeFinal = tamanho_time;
      }

      // Se o jogo está 'andamento', pegamos do DB
      if (status === 'andamento') {
        if (!tamanhoTimeFinal) {
          console.error('Erro: O jogo está em andamento, mas não há tamanho_time definido no BD.');
          return res.status(400).json({
            error: 'O jogo está em andamento, mas não há tamanho_time definido no BD.',
          });
        }
      }

      console.log('Buscando jogadores para balanceamento.');
      // Agora buscamos jogadores
      const jogadoresQuery = await client.query(
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
        console.error('Erro: Nenhum jogador encontrado para balanceamento.');
        return res.status(400).json({
          error: 'Nenhum jogador encontrado para balanceamento.',
        });
      }

      // Log após buscar jogadores
      console.log('Jogadores encontrados para balanceamento:', jogadoresQuery.rows);

      const jogadores = jogadoresQuery.rows;

      // Faz o balanceamento usando a função que respeita o tamanho_time
      console.log('Iniciando balanceamento de jogadores.');
      const { times, reservas } = balancearJogadores(jogadores, tamanhoTimeFinal);

      // Logs após o balanceamento
      console.log('Times gerados pelo balanceamento:', JSON.stringify(times, null, 2));
      console.log('Reservas geradas pelo balanceamento:', JSON.stringify(reservas, null, 2));

      // Calcula o custo do balanceamento (opcional)
      const custo = calcularCusto(times);
      console.log(`Custo do balanceamento: ${custo}`);

      // Log antes de preparar a resposta
      console.log('Preparando resposta para o cliente.');

      // Inicia transação
      await client.query('BEGIN');
      console.log('Transação iniciada.');

      // Remove times antigos
      console.log('Removendo times antigos do jogo.');
      await client.query('DELETE FROM times WHERE id_jogo = $1', [id_jogo]);
      console.log('Times antigos removidos.');

      // Insere os novos times
      console.log('Inserindo novos times no banco de dados.');
      for (const [index, time] of times.entries()) {
        const numeroTime = index + 1;
        for (const jogador of time.jogadores) {
          await client.query(
            `
              INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
              VALUES ($1, $2, $3, $4, $5)
            `,
            [
              id_jogo,
              numeroTime,
              jogador.id_usuario,
              time.totalScore,
              jogador.altura
            ]
          );
          console.log(`Jogador ${jogador.id_usuario} inserido no Time ${numeroTime}.`);
        }
      }

      // Insere reservas
      console.log('Inserindo reservas no banco de dados.');
      for (const reserva of reservas) {
        await client.query(
          `
            INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
            VALUES ($1, $2, $3, 0, $4)
          `,
          [id_jogo, 99, reserva.id_usuario, reserva.altura]
        );
        console.log(`Reserva ${reserva.id_usuario} inserida com numero_time 99.`);
      }

      // Se o jogo ainda estiver 'aberto', mude pra 'andamento'
      if (status === 'aberto') {
        console.log('Atualizando status do jogo para "andamento".');
        await client.query(
          `UPDATE jogos SET status = 'andamento' WHERE id_jogo = $1`,
          [id_jogo]
        );
      }

      // Commit da transação
      await client.query('COMMIT');
      console.log('Transação comitada com sucesso.');

      // Log final antes de enviar a resposta
      console.log('Retorno para o cliente:', {
        message: 'Balanceamento realizado com sucesso!',
        status: 'andamento',
        times,
        reservas,
      });

      return res.status(200).json({
        message: 'Balanceamento realizado com sucesso!',
        status: 'andamento',
        times,
        reservas,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Erro ao iniciar balanceamento:', error);
      return res.status(500).json({
        error: 'Erro ao iniciar balanceamento.',
        details: error.message,
      });
    } finally {
      client.release();
      console.log('Cliente de transação liberado.');
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
    const client = await db.getClient();
    try {
      console.log('=== Nova requisição recebida ===');
      console.log('Método: POST');
      console.log('URL: /api/jogador/finalizar-balanceamento');
      console.log('Body:', JSON.stringify(req.body, null, 2));
      console.log('===============================');

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
      await client.query(
        `
          UPDATE jogos 
          SET status = 'finalizado' 
          WHERE id_jogo = $1
        `,
        [id_jogo]
      );

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

        for (const jogador of time.jogadores) {
          if (!jogador.id_usuario || typeof jogador.id_usuario !== 'number') {
            console.error(`Erro: Jogador inválido no Time ${numeroTime}:`, jogador);
            throw new Error(
              `id_usuario inválido ou ausente para um dos jogadores no Time ${numeroTime}.`
            );
          }

          console.log(`Inserindo Jogador ID: ${jogador.id_usuario}, Time: ${numeroTime}`);

          await client.query(
            `
              INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
              VALUES ($1, $2, $3, $4, $5)
            `,
            [
              id_jogo,
              numeroTime,
              jogador.id_usuario,
              time.totalScore || 0,
              jogador.altura || 0,
            ]
          );

          console.log(`Jogador ${jogador.id_usuario} inserido no Time ${numeroTime}.`);
        }
      }

      // Commit da transação
      await client.query('COMMIT');
      console.log('Transação comitada com sucesso.');

      return res.status(200).json({
        message: 'Balanceamento finalizado.',
        status: 'finalizado',
        id_jogo,
        times,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Erro ao finalizar balanceamento:', error);
      return res.status(500).json({
        error: 'Erro ao finalizar balanceamento.',
        details: error.message,
      });
    } finally {
      client.release();
      console.log('Cliente de transação liberado.');
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
    const client = await db.getClient();
    try {
      console.log('=== Nova requisição recebida ===');
      console.log('Método: POST');
      console.log('URL: /api/jogador/atualizar-times');
      console.log('Body:', JSON.stringify(req.body, null, 2));
      console.log('===============================');

      const { id_jogo, times } = req.body;

      if (!id_jogo || !times || !Array.isArray(times)) {
        console.error('Erro: id_jogo e times são obrigatórios, e times deve ser uma lista.');
        return res.status(400).json({
          error: 'id_jogo e times são obrigatórios, e times deve ser uma lista.',
        });
      }

      console.log('Times recebidos para inserção:', JSON.stringify(times, null, 2));

      // Iniciar uma transação
      await client.query('BEGIN');
      console.log('Transação iniciada.');

      // Verificar se o jogo existe
      console.log(`Verificando existência do jogo com id_jogo: ${id_jogo}`);
      const jogoQuery = await client.query(
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
      console.log('Jogo verificado com sucesso:', JSON.stringify(jogoQuery.rows, null, 2));

      // Remover times existentes para o jogo
      console.log(`Removendo times existentes para o jogo ID: ${id_jogo}`);
      const deleteResult = await client.query('DELETE FROM times WHERE id_jogo = $1', [id_jogo]);
      console.log(`Resultado da consulta de DELETE: ${deleteResult.rowCount} linha(s) deletada(s).`);

      // Inserir novos times com numero_time corretamente atribuído
      console.log('Inserindo novos times no banco de dados.');
      for (const [index, time] of times.entries()) {
        const numeroTime = index + 1;
        console.log(`\nInserindo Time ${numeroTime}:`, JSON.stringify(time, null, 2));

        if (!Array.isArray(time.jogadores) || time.jogadores.length === 0) {
          throw new Error(`"jogadores" deve ser um array não vazio no Time ${numeroTime}.`);
        }

        for (const jogador of time.jogadores) {
          if (!jogador.id_usuario || typeof jogador.id_usuario !== 'number') {
            console.error(`Erro: id_usuario inválido para um dos jogadores no Time ${numeroTime}.`, jogador);
            throw new Error(`id_usuario inválido para um dos jogadores no Time ${numeroTime}.`);
          }

          console.log(`Inserindo Jogador ID: ${jogador.id_usuario}, Time: ${numeroTime}`);

          await client.query(
            `
              INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
              VALUES ($1, $2, $3, $4, $5)
            `,
            [
              id_jogo,
              numeroTime,
              jogador.id_usuario,
              time.totalScore || 0,
              time.totalAltura || 0,
            ]
          );

          console.log(`Jogador ${jogador.id_usuario} inserido no Time ${numeroTime}.`);
        }
      }

      // Commit da transação
      await client.query('COMMIT');
      console.log('Transação comitada com sucesso.');

      return res.status(200).json({
        message: 'Times atualizados com sucesso!',
        times,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Erro ao atualizar times:', error);
      return res.status(500).json({
        error: 'Erro ao atualizar os times.',
        details: error.message,
      });
    } finally {
      client.release();
      console.log('Cliente de transação liberado.');
    }
  }
);

// OBSERVAÇÃO: Rota POST /equilibrar-times removida do seu exemplo original.

module.exports = router;
