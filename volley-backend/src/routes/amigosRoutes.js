const express = require('express');
const router = express.Router();
const db = require('../db'); // Conexão com o banco de dados

// Middleware para logging
router.use((req, res, next) => {
  console.log(`\n=== Nova requisição recebida ===`);
  console.log(`Método: ${req.method}`);
  console.log(`URL: ${req.originalUrl}`);
  console.log(`Body:`, req.body);
  console.log(`Params:`, req.params);
  console.log('================================\n');
  next();
});

// Adicionar um amigo
router.post('/adicionar', async (req, res) => {
  const { organizador_id, amigo_id } = req.body;

  if (!organizador_id || !amigo_id) {
    console.error('Erro: Organizador ou Amigo não fornecido.', req.body);
    return res.status(400).json({ message: 'Organizador e Amigo são obrigatórios.' });
  }

  try {
    // Buscar o id_usuario do amigo com base no tt
    const amigoResult = await db.query(
      'SELECT id_usuario FROM public.usuario WHERE tt = $1',
      [amigo_id]
    );

    if (amigoResult.rows.length === 0) {
      return res.status(404).json({ message: 'Amigo não encontrado pelo TT fornecido.' });
    }

    const amigoUsuarioId = amigoResult.rows[0].id_usuario;
    console.log(`Adicionando amigo ID ${amigoUsuarioId} ao organizador ${organizador_id}`);

    // Inserir na tabela amizades
    await db.query(
      `INSERT INTO amizades (organizador_id, amigo_id) VALUES ($1, $2)
       ON CONFLICT (organizador_id, amigo_id) DO NOTHING`,
      [organizador_id, amigoUsuarioId]
    );

    console.log(`Amigo ${amigoUsuarioId} adicionado com sucesso ao organizador ${organizador_id}`);
    return res.status(201).json({ message: 'Amigo adicionado com sucesso.' });
  } catch (error) {
    console.error('Erro ao adicionar amigo:', error);
    return res.status(500).json({ message: 'Erro ao adicionar amigo.', error });
  }
});

// Listar amigos
router.get('/listar/:organizador_id', async (req, res) => {
  const { organizador_id } = req.params;

  try {
    const result = await db.query(
      `SELECT u.id_usuario AS id, u.nome, u.email, u.tt, u.imagem_perfil
       FROM usuario u
       JOIN amizades a ON u.id_usuario = a.amigo_id
       WHERE a.organizador_id = $1`,
      [organizador_id]
    );

    if (result.rows.length === 0) {
      console.warn(`Nenhum amigo encontrado para o organizador: ${organizador_id}`);
      return res.status(404).json({ message: 'Nenhum amigo encontrado.' });
    }

    console.log(`Amigos encontrados para o organizador ${organizador_id}:`, result.rows);
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('Erro ao listar amigos:', error);
    return res.status(500).json({ message: 'Erro ao listar amigos.', error });
  }
});

// Buscar amigos com sugestões (nome ou ID)
router.get('/buscar', async (req, res) => {
  const { organizador_id, termo } = req.query;

  if (!organizador_id || !termo) {
    return res.status(400).json({ message: 'Organizador e termo de busca são obrigatórios.' });
  }

  try {
    const result = await db.query(
      `
      SELECT u.id_usuario AS id, u.nome, u.email, u.tt, u.imagem_perfil
      FROM usuario u
      WHERE (LOWER(u.nome) LIKE LOWER($1) OR LOWER(u.tt) LIKE LOWER($1))
      AND u.id_usuario NOT IN (
        SELECT amigo_id FROM amizades WHERE organizador_id = $2
      )
      LIMIT 10
      `,
      [`%${termo}%`, organizador_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Nenhum amigo encontrado.' });
    }

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar amigos:', error);
    res.status(500).json({ message: 'Erro ao buscar amigos.' });
  }
});

// Equilibrar times com amigos selecionados
router.post('/equilibrar-amigos-selecionados', async (req, res) => {
  const { amigosSelecionados } = req.body;

  if (!amigosSelecionados || amigosSelecionados.length === 0) {
    console.error('Erro: Nenhum amigo selecionado.', req.body);
    return res.status(400).json({ message: 'Nenhum amigo selecionado.' });
  }

  try {
    console.log('Equilibrando times para amigos selecionados:', amigosSelecionados);
    const jogadores = await db.query(
      `SELECT u.id_usuario, u.nome, u.tt,
              COALESCE(a.passe, 0) AS passe, 
              COALESCE(a.ataque, 0) AS ataque, 
              COALESCE(a.levantamento, 0) AS levantamento
       FROM usuario u
       LEFT JOIN avaliacoes a ON u.id_usuario = a.usuario_id
       WHERE u.id_usuario = ANY($1)`,
      [amigosSelecionados]
    );

    if (jogadores.rows.length === 0) {
      console.warn('Nenhum jogador encontrado para os IDs fornecidos:', amigosSelecionados);
      return res.status(404).json({ message: 'Nenhum jogador encontrado.' });
    }

    console.log('Jogadores encontrados:', jogadores.rows);
    const times = balancearTimes(jogadores.rows);

    console.log('Times equilibrados:', times);
    res.status(200).json({ times });
  } catch (error) {
    console.error('Erro ao equilibrar times:', error);
    res.status(500).json({ message: 'Erro interno ao equilibrar times.' });
  }
});

// Função para balancear os times
function balancearTimes(jogadores) {
  jogadores.sort((a, b) => {
    const totalA = (a.passe || 0) + (a.ataque || 0) + (a.levantamento || 0);
    const totalB = (b.passe || 0) + (b.ataque || 0) + (b.levantamento || 0);
    return totalB - totalA;
  });

  const time1 = [];
  const time2 = [];

  jogadores.forEach((jogador, index) => {
    if (index % 2 === 0) {
      time1.push(jogador);
    } else {
      time2.push(jogador);
    }
  });

  return [time1, time2];
}

// Atualizar frequência de interação com amigo
router.post('/frequencia', async (req, res) => {
  const { organizador_id, amigo_id } = req.body;

  if (!organizador_id || !amigo_id) {
    return res.status(400).json({ message: 'Organizador e amigo são obrigatórios.' });
  }

  try {
    await db.query(
      `INSERT INTO amigos_frequentes (organizador_id, amigo_id, frequencia)
       VALUES ($1, $2, 1)
       ON CONFLICT (organizador_id, amigo_id) 
       DO UPDATE SET frequencia = amigos_frequentes.frequencia + 1`,
      [organizador_id, amigo_id]
    );

    res.status(200).json({ message: 'Frequência atualizada com sucesso.' });
  } catch (error) {
    console.error('Erro ao atualizar frequência:', error);
    res.status(500).json({ message: 'Erro ao atualizar frequência.' });
  }
});

// Listar amigos frequentes
router.get('/frequentes/:organizador_id', async (req, res) => {
  const { organizador_id } = req.params;

  try {
    const result = await db.query(
      `SELECT u.id_usuario AS id, u.nome, u.email, u.tt, af.frequencia
       FROM usuario u
       JOIN amigos_frequentes af ON u.id_usuario = af.amigo_id
       WHERE af.organizador_id = $1
       ORDER BY af.frequencia DESC`,
      [organizador_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Nenhum amigo frequente encontrado.' });
    }

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Erro ao listar amigos frequentes:', error);
    res.status(500).json({ message: 'Erro ao listar amigos frequentes.' });
  }
});

module.exports = router;
