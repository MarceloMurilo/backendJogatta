const express = require('express');
const router = express.Router();
const db = require('../../db'); // Conexão com o banco de dados
const authMiddleware = require('../../middlewares/authMiddleware'); // Certifique-se de que o caminho está correto
const roleMiddleware = require('../../middlewares/roleMiddleware'); 

// Este arquivo deve ser focado exclusivamente no balanceamento de times, incluindo:
// Distribuir jogadores.
// Cálculos de custo e variância.
// Geração de rotações sugeridas.


// Função para embaralhar um array (Fisher-Yates shuffle)
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

// Função de custo com pesos customizáveis
const calcularCusto = (times, pesoPontuacao = 1, pesoAltura = 1) => {
  const pontuacoes = times.map(t => t.totalScore);
  const alturasMedias = times.map(t =>
    t.jogadores.length > 0 ? t.totalAltura / t.jogadores.length : 0
  );

  const varPontuacao = calcularVariancia(pontuacoes);
  const varAltura = calcularVariancia(alturasMedias);

  return (pesoPontuacao * varPontuacao) + (pesoAltura * varAltura);
};

// Função para calcular a distância euclidiana entre dois jogadores (opcional para rotação)
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

// Função para gerar sugestões de rotação
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

    // Ordenar sugeridos por menor distância (maior compatibilidade)
    sugeridos.sort((a, b) => a.distancia - b.distancia);

    // Selecionar os topN mais compatíveis
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
   NOVOS ENDPOINTS ADICIONADOS (para controlar o status do organizador)
   -------------------------------------------------------------------
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

      console.log('Recebido /iniciar-balanceamento:', req.body); // Log para depuração

      // Verifica se o ID do jogo foi enviado
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

      // Verifica se o jogo já está em andamento ou finalizado
      if (status === 'encerrada' || status === 'equilibrando') {
        return res.status(400).json({
          error: 'O jogo já está em andamento ou foi encerrado.',
        });
      }

      // Atualiza o status do jogo para "equilibrando"
      await db.query(
        `UPDATE jogos SET status = 'equilibrando' WHERE id_jogo = $1`,
        [id_jogo]
      );

      // Atualiza o status na tabela usuario_funcao
      const expiraEm = new Date(Date.now() + 3 * 60 * 60 * 1000); // Expira em 3 horas
      await db.query(
        `INSERT INTO usuario_funcao (id_usuario, id_funcao, id_jogo, criado_em, expira_em)
         VALUES ($1, 1, $2, NOW(), $3)
         ON CONFLICT (id_usuario, id_funcao, id_jogo) 
         DO UPDATE SET criado_em = NOW(), expira_em = $3`,
        [organizador_id, id_jogo, expiraEm]
      );

      return res.status(200).json({
        message: 'O organizador iniciou o balanceamento.',
        status: 'equilibrando',
        id_jogo: id_jogo, // Incluindo o id_jogo na resposta
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
 * Marca o status do jogo como 'concluido'
 * Retorna times gerados (ou armazenados) para exibir ao usuário
 */
router.post(
  '/finalizar-balanceamento',
  authMiddleware,
  async (req, res) => {
    try {
      const { id_jogo, id_usuario_organizador, times } = req.body;
      console.log('Recebido /finalizar-balanceamento:', req.body); // Log para depuração

      // Validações iniciais
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

      // Atualiza o status do jogo para "concluido"
      await db.query(
        `UPDATE jogos SET status = 'concluido' WHERE id_jogo = $1`,
        [id_jogo]
      );

      // Remove o papel de organizador na tabela usuario_funcao
      await db.query(
        `DELETE FROM usuario_funcao WHERE id_usuario = $1 AND id_jogo = $2 AND id_funcao = 1`,
        [id_usuario_organizador, id_jogo]
      );

      // (Opcional) Salvar os times no banco de dados
      // Salva os times e seus jogadores no banco, se necessário
      for (const [index, time] of times.entries()) {
        for (const jogador of time.jogadores) {
          await db.query(
            `INSERT INTO times (id_jogo, numero_time, id_usuario, total_score, total_altura)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              id_jogo,
              index + 1, // Número do time (1, 2, ...)
              jogador.id,
              time.totalScore,
              time.totalAltura,
            ]
          );
        }
      }

      return res.status(200).json({
        message: 'Balanceamento finalizado.',
        status: 'concluido',
        id_jogo, // Incluído para confirmar qual jogo foi atualizado
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
   ROTA ORIGINAL DE EQUILIBRAR TIMES
=================================================================== */
router.post('/equilibrar-times', async (req, res) => {
  console.log('==== Requisição recebida em /equilibrar-times ====');
  console.log('Payload recebido:', JSON.stringify(req.body, null, 2));

  const { organizador_id, id_jogo, tamanho_time, jogadores } = req.body;

  // Validações iniciais
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
    console.log('Consultando jogadores no banco de dados com base nos IDs fornecidos...');

    // Monta a query para buscar informações dos jogadores
    const baseIndex = id_jogo ? 3 : 2;
    const placeholders = jogadores.map((_, index) => `$${index + baseIndex}`).join(', ');

    const query = `
      SELECT u.nome, u.id_usuario AS usuario_id, u.altura, 
             a.passe, a.ataque, a.levantamento
      FROM avaliacoes a
      JOIN usuario u ON a.usuario_id = u.id_usuario
      ${id_jogo ? 'JOIN participacao_jogos pj ON pj.id_usuario = a.usuario_id' : ''}
      WHERE a.organizador_id = $1
      ${id_jogo ? 'AND pj.id_jogo = $2' : ''}
      AND a.usuario_id IN (${placeholders})
    ;`;

    const params = id_jogo
      ? [organizador_id, id_jogo, ...jogadores]
      : [organizador_id, ...jogadores];

    console.log('Executando consulta SQL:', query, '| Parâmetros:', params);
    const jogadoresResult = await db.query(query, params);

    if (jogadoresResult.rows.length === 0) {
      return res.status(404).json({ message: 'Nenhum jogador encontrado com os critérios fornecidos.' });
    }

    // Processar jogadores e calcular suas pontuações
    let jogadoresComPontuacao = jogadoresResult.rows.map((jogador) => ({
      id: jogador.usuario_id,
      nome: jogador.nome,
      altura: parseFloat(jogador.altura) || 0,
      passe: jogador.passe,
      ataque: jogador.ataque,
      levantamento: jogador.levantamento,
      total: jogador.passe + jogador.ataque + jogador.levantamento,
    }));

    // Embaralhar e ordenar jogadores
    jogadoresComPontuacao = embaralharJogadores(jogadoresComPontuacao);
    jogadoresComPontuacao.sort((a, b) => b.total - a.total);

    const numero_times = Math.floor(jogadoresComPontuacao.length / tamanho_time);

    if (numero_times < 2) {
      return res.status(400).json({
        message: `Jogadores insuficientes. Necessário no mínimo ${tamanho_time * 2} jogadores para formar 2 times.`,
      });
    }

    // Separar levantadores e não-levantadores
    let levantadores = jogadoresComPontuacao.filter((j) => j.levantamento >= 4);
    let naoLevantadores = jogadoresComPontuacao.filter((j) => j.levantamento < 4);

    console.log(`Total de levantadores: ${levantadores.length}`);
    console.log(`Total de não-levantadores: ${naoLevantadores.length}`);

    // Garantir pelo menos um levantador por time
    if (levantadores.length < numero_times) {
      const needed = numero_times - levantadores.length;
      naoLevantadores.sort((a, b) => b.levantamento - a.levantamento);
      const substitutos = naoLevantadores.slice(0, needed);
      levantadores = levantadores.concat(substitutos);
      naoLevantadores = naoLevantadores.slice(needed);
    }

    // Criar estrutura dos times
    const times = Array.from({ length: numero_times }, () => ({
      jogadores: [],
      totalScore: 0,
      totalAltura: 0,
    }));

    // Distribuir levantadores nos times
    levantadores.forEach((lev, index) => {
      const timeIndex = index % numero_times;
      times[timeIndex].jogadores.push(lev);
      times[timeIndex].totalScore += lev.total;
      times[timeIndex].totalAltura += lev.altura;
    });

    // Distribuir os demais jogadores minimizando o custo
    naoLevantadores.forEach((jogador) => {
      let melhorTime = -1;
      let menorCusto = Infinity;

      times.forEach((time, index) => {
        if (time.jogadores.length < tamanho_time) {
          const custo = calcularCusto([time], jogador);
          if (custo < menorCusto) {
            menorCusto = custo;
            melhorTime = index;
          }
        }
      });

      if (melhorTime !== -1) {
        times[melhorTime].jogadores.push(jogador);
        times[melhorTime].totalScore += jogador.total;
        times[melhorTime].totalAltura += jogador.altura;
      }
    });

    // Recalcular reservas
    const jogadoresAlocados = times.flatMap((time) => time.jogadores.map((j) => j.id));
    const reservas = jogadoresComPontuacao.filter((j) => !jogadoresAlocados.includes(j.id));

    console.log('Times finais:', JSON.stringify(times, null, 2));
    console.log('Reservas finais:', JSON.stringify(reservas, null, 2));

    // Gera sugestões de rotação
    const rotacoes = gerarSugerirRotacoes(times, reservas, 2);
    console.log('Sugestões de rotação:', JSON.stringify(rotacoes, null, 2));

    return res.json({
      id_jogo: id_jogo || null, // Retorna ID do jogo, se disponível
      times,
      reservas,
      rotacoes,
    });
  } catch (error) {
    console.error('Erro ao equilibrar times:', error);
    return res.status(500).json({ message: 'Erro ao equilibrar times.', error: error.message });
  }
});
/* ===================================================================
   NOVAS ROTAS PARA GERENCIAR HABILIDADES (OFFLINE)
   /jogos/:jogoId/habilidades [GET, POST]
=================================================================== */

// // GET - Retorna habilidades dos jogadores (baseado em avaliacoes do ORGANIZADOR do jogo)
// router.get('/:jogoId/habilidades', async (req, res) => {
//   try {
//     const { jogoId } = req.params;

//     // Primeiro, obter o organizador do jogo
//     const queryJogo = await db.query('SELECT id_usuario FROM jogos WHERE id_jogo = $1', [jogoId]);
//     if (queryJogo.rowCount === 0) {
//       return res.status(404).json({ message: 'Jogo não encontrado.' });
//     }
//     const organizador_id= queryJogo.rows[0].id_usuario;

//     // Buscar participantes e suas habilidades (avaliacoes)
//     const result = await db.query(
//       `SELECT 
//          pj.id_usuario AS id,
//          u.nome,
//          COALESCE(a.passe, 0) AS passe,
//          COALESCE(a.ataque, 0) AS ataque,
//          COALESCE(a.levantamento, 0) AS levantamento
//        FROM participacao_jogos pj
//          JOIN usuario u ON pj.id_usuario = u.id_usuario
//          LEFT JOIN avaliacoes a 
//                 ON a.usuario_id = pj.id_usuario
//                AND a.organizador_id = $1
//        WHERE pj.id_jogo = $2
//       `,
//       [organizador_id, jogoId]
//     );

//     if (result.rows.length === 0) {
//       return res.status(404).json({ message: 'Nenhum jogador encontrado para este jogo.' });
//     }

//     return res.status(200).json(result.rows);
//   } catch (error) {
//     console.error('Erro ao buscar habilidades dos jogadores:', error);
//     return res.status(500).json({ message: 'Erro ao buscar habilidades dos jogadores.', error });
//   }
// });

// // POST - Salva ou atualiza habilidades dos jogadores (UP-SERT em avaliacoes)
// router.post('/:jogoId/habilidades', async (req, res) => {
//   try {
//     const { jogoId } = req.params;
//     const { habilidades } = req.body;

//     console.log("Recebido /jogos/:jogoId/habilidades POST:", req.body); // Log para depuração

//     if (!habilidades || !Array.isArray(habilidades) || habilidades.length === 0) {
//       return res.status(400).json({ message: 'Nenhuma habilidade fornecida.' });
//     }

//     // Obter organizador (para usar como organizador_id em avaliacoes)
//     const queryJogo = await db.query('SELECT id_usuario FROM jogos WHERE id_jogo = $1', [jogoId]);
//     if (queryJogo.rowCount === 0) {
//       return res.status(404).json({ message: 'Jogo não encontrado.' });
//     }
//     const organizador_id= queryJogo.rows[0].id_usuario;

//     // Percorrer as habilidades e fazer upsert
//     for (const jogador of habilidades) {
//       const { id, passe, ataque, levantamento } = jogador;
//       if (!id) {
//         return res.status(400).json({ message: 'ID do jogador é obrigatório em cada habilidade.' });
//       }

//       await db.query(
//         `INSERT INTO avaliacoes (usuario_id, organizador_id, passe, ataque, levantamento)
//          VALUES ($1, $2, $3, $4, $5)
//          ON CONFLICT (usuario_id, organizador_id)
//          DO UPDATE SET 
//            passe = EXCLUDED.passe,
//            ataque = EXCLUDED.ataque,
//            levantamento = EXCLUDED.levantamento
//         `,
//         [id, organizador_id, passe || 0, ataque || 0, levantamento || 0]
//       );
//     }

//     return res.status(200).json({ message: 'Habilidades atualizadas com sucesso.' });
//   } catch (error) {
//     console.error('Erro ao salvar habilidades dos jogadores:', error);
//     return res.status(500).json({ message: 'Erro ao salvar habilidades dos jogadores.', error });
//   }
// });

module.exports = router;
