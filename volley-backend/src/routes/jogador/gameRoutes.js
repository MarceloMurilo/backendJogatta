const express = require('express');
const router = express.Router();
const db = require('../../db');

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
  const alturasMedias = times.map(t => t.jogadores.length > 0 ? t.totalAltura / t.jogadores.length : 0);

  const varPontuacao = calcularVariancia(pontuacoes);
  const varAltura = calcularVariancia(alturasMedias);

  return (pesoPontuacao * varPontuacao) + (pesoAltura * varAltura);
};

// Função para calcular a distância euclidiana entre dois jogadores
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

router.post('/equilibrar-times', async (req, res) => {
  console.log('==== Requisição recebida em /equilibrar-times ====');
  console.log('Payload recebido:', JSON.stringify(req.body, null, 2));

  const { organizador_id, jogo_id, tamanho_time, jogadores } = req.body;

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
    console.log('Consultando jogadores no banco de dados com base nos selecionados...');

    // Monta os placeholders para o IN
    const baseIndex = jogo_id ? 3 : 2;
    const placeholders = jogadores.map((_, index) => `$${index + baseIndex}`).join(', ');

    const query = `
      SELECT u.nome, u.id_usuario AS usuario_id, u.altura, 
             a.passe, a.ataque, a.levantamento
      FROM avaliacoes a
      JOIN usuario u ON a.usuario_id = u.id_usuario
      ${jogo_id ? 'JOIN participacao_jogos pj ON pj.id_usuario = a.usuario_id' : ''}
      WHERE a.organizador_id = $1
      ${jogo_id ? 'AND pj.id_jogo = $2' : ''}
      AND a.usuario_id IN (${placeholders})
    ;`;

    const params = jogo_id 
      ? [organizador_id, jogo_id, ...jogadores]
      : [organizador_id, ...jogadores];

    console.log('Executando consulta SQL:', query, '| Parâmetros:', params);
    const jogadoresResult = await db.query(query, params);

    if (jogadoresResult.rows.length === 0) {
      return res.status(404).json({ message: 'Nenhum jogador encontrado com os critérios fornecidos.' });
    }

    let jogadoresComPontuacao = jogadoresResult.rows.map((jogador) => ({
      id: jogador.usuario_id,
      nome: jogador.nome,
      altura: parseFloat(jogador.altura) || 0,
      passe: jogador.passe,
      ataque: jogador.ataque,
      levantamento: jogador.levantamento,
      total: jogador.passe + jogador.ataque + jogador.levantamento,
    }));

    // Embaralhar a lista de jogadores para introduzir aleatoriedade
    jogadoresComPontuacao = embaralharJogadores(jogadoresComPontuacao);

    // Ordenar jogadores por total de habilidades (desc) para melhor balanceamento
    jogadoresComPontuacao.sort((a, b) => b.total - a.total);

    const numero_times = Math.floor(jogadoresComPontuacao.length / tamanho_time);

    if (numero_times < 1) {
      return res.status(400).json({
        message: 'Jogadores insuficientes para formar ao menos um time completo.',
      });
    }

    if (jogadoresComPontuacao.length < tamanho_time * 2) {
      return res.status(400).json({
        message: `Jogadores insuficientes. Necessário no mínimo ${tamanho_time * 2} jogadores para formar pelo menos 2 times.`,
      });
    }

    // Separar levantadores
    let levantadores = jogadoresComPontuacao.filter(j => j.levantamento >= 4);
    let naoLevantadores = jogadoresComPontuacao.filter(j => j.levantamento < 4);

    console.log(`Total de levantadores: ${levantadores.length}`);
    console.log(`Total de não-levantadores: ${naoLevantadores.length}`);

    // Se não houver levantadores suficientes para cada time, criar substitutos
    if (levantadores.length < numero_times) {
      naoLevantadores.sort((a, b) => b.levantamento - a.levantamento);
      const needed = numero_times - levantadores.length;
      const substitutos = naoLevantadores.slice(0, needed);
      naoLevantadores = naoLevantadores.slice(needed);
      levantadores = levantadores.concat(substitutos);

      if (levantadores.length < numero_times) {
        return res.status(400).json({
          message: 'Não foi possível garantir um levantador ou substituto adequado para cada time.'
        });
      }
    }

    // Criar estrutura dos times
    const times = Array.from({ length: numero_times }, () => ({
      jogadores: [],
      totalScore: 0,
      totalAltura: 0,
    }));

    // Distribuir um levantador em cada time primeiro
    levantadores.sort((a, b) => b.total - a.total);
    for (let i = 0; i < numero_times; i++) {
      const lev = levantadores[i];
      times[i].jogadores.push(lev);
      times[i].totalScore += lev.total;
      times[i].totalAltura += lev.altura;
    }

    const jogadoresAlocados = times.flatMap(time => time.jogadores.map(j => j.id));
    let reservas = jogadoresComPontuacao.filter(j => !jogadoresAlocados.includes(j.id));

    let filtrados = reservas.slice();
    filtrados.sort((a, b) => b.total - a.total);

    // Embaralhar os filtrados para garantir inclusão
    filtrados = embaralharJogadores(filtrados);

    const pesoPontuacao = 1; // Ajuste se necessário
    const pesoAltura = 1;    // Ajuste se necessário

    // Distribuir os demais jogadores minimizando o custo
    filtrados.forEach(jogador => {
      let melhorTime = -1;
      let melhorCusto = Infinity;
      const custoInicial = calcularCusto(times, pesoPontuacao, pesoAltura);

      for (let t = 0; t < numero_times; t++) {
        if (times[t].jogadores.length >= tamanho_time) {
          continue;
        }
        const custoFinal = calcularCusto([
          ...times.slice(0, t),
          {
            jogadores: [...times[t].jogadores, jogador],
            totalScore: times[t].totalScore + jogador.total,
            totalAltura: times[t].totalAltura + jogador.altura,
          },
          ...times.slice(t + 1)
        ], pesoPontuacao, pesoAltura);

        const delta = custoFinal - custoInicial;
        if (delta < melhorCusto) {
          melhorCusto = delta;
          melhorTime = t;
        }
      }

      if (melhorTime !== -1 && times[melhorTime].jogadores.length < tamanho_time) {
        times[melhorTime].jogadores.push(jogador);
        times[melhorTime].totalScore += jogador.total;
        times[melhorTime].totalAltura += jogador.altura;
      }
    });

    // Recalcular quem ficou de fora como reservas finais
    const jogadoresAlocadosFinal = times.flatMap(time => time.jogadores.map(j => j.id));
    let reservasFinal = jogadoresComPontuacao.filter(j => !jogadoresAlocadosFinal.includes(j.id));

    // Embaralhar as reservas finais para garantir inclusão
    reservasFinal = embaralharJogadores(reservasFinal);

    console.log('Distribuindo jogadores restantes nos times...');
    console.log('Times equilibrados:', JSON.stringify(times, null, 2));
    console.log('Jogadores em reserva:', JSON.stringify(reservasFinal, null, 2));

    const rotacoes = gerarSugerirRotacoes(times, reservasFinal, 2);

    console.log('Sugestões de Rotação:', JSON.stringify(rotacoes, null, 2));

    // Verificação final do tamanho dos times
    for (let i = 0; i < numero_times; i++) {
      if (times[i].jogadores.length !== tamanho_time) {
        return res.status(500).json({
          message: `Erro interno: o time ${i + 1} não atingiu o tamanho esperado de ${tamanho_time} jogadores.`,
          time: times[i],
        });
      }
    }

    return res.json({ 
      times, 
      reservas: reservasFinal, 
      rotacoes 
    });
  } catch (error) {
    console.error('Erro ao equilibrar times:', error);
    return res.status(500).json({ message: 'Erro ao equilibrar times.', error: error.message });
  }
});

module.exports = router;
