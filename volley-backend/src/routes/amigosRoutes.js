/**
 * Arquivo: routes/amigos.js
 */
const express = require('express');
const router = express.Router();
const db = require('../db'); // Conexão com o banco de dados

// Middleware para logging (opcional)
router.use((req, res, next) => {
  console.log(`\n=== Nova requisição em /api/amigos ===`);
  console.log(`Método: ${req.method}`);
  console.log(`URL: ${req.originalUrl}`);
  console.log(`Body:`, req.body);
  console.log(`Params:`, req.params);
  console.log('================================\n');
  next();
});

// ==================================================================
// Adicionar um amigo
// ==================================================================
router.post('/adicionar', async (req, res) => {
  const { organizador_id, amigo_id } = req.body;

  if (!organizador_id || !amigo_id) {
    return res.status(400).json({ message: 'Organizador e Amigo são obrigatórios.' });
  }

  try {
    // Verificar se o amigo realmente existe no banco
    const amigoResult = await db.query(
      'SELECT id_usuario FROM public.usuario WHERE id_usuario = $1',
      [amigo_id]
    );
    if (amigoResult.rows.length === 0) {
      return res.status(404).json({ message: 'Amigo não encontrado pelo ID fornecido.' });
    }

    // Impedir que o usuário se adicione a si mesmo
    if (organizador_id === amigo_id) {
      return res.status(400).json({ message: 'Você não pode se adicionar como amigo.' });
    }

    // Inserir na tabela amizades (ignora caso já exista)
    await db.query(
      `INSERT INTO amizades (organizador_id, amigo_id)
       VALUES ($1, $2)
       ON CONFLICT (organizador_id, amigo_id)
       DO NOTHING`,
      [organizador_id, amigo_id]
    );

    return res.status(201).json({ message: 'Amigo adicionado com sucesso.' });
  } catch (error) {
    console.error('Erro ao adicionar amigo:', error);
    return res.status(500).json({ message: 'Erro ao adicionar amigo.', error });
  }
});

// ==================================================================
// Remover um amigo
// ==================================================================
router.post('/remover', async (req, res) => {
  const { organizador_id, amigo_id } = req.body;

  if (!organizador_id || !amigo_id) {
    return res.status(400).json({ message: 'Organizador e Amigo são obrigatórios.' });
  }

  try {
    const result = await db.query(
      `DELETE FROM amizades
       WHERE organizador_id = $1 AND amigo_id = $2`,
      [organizador_id, amigo_id]
    );

    // Ao invés de retornar 404, retornamos 200 mesmo não encontrando:
    if (result.rowCount === 0) {
      return res.status(200).json({ message: 'Vocês já não eram amigos.' });
    }

    return res.status(200).json({ message: 'Amigo removido com sucesso.' });
  } catch (error) {
    console.error('Erro ao remover amigo:', error);
    return res.status(500).json({ message: 'Erro ao remover amigo.', error });
  }
});

// ==================================================================
// Listar amigos com paginação e busca
// ==================================================================
router.get('/listar/:organizador_id', async (req, res) => {
  try {
    const { organizador_id } = req.params;
    const {
      page = 1,
      limit = 10,
      searchTerm = '',
    } = req.query;

    // Verifica se o organizador_id é válido
    if (!organizador_id) {
      return res.status(400).json({ message: 'ID do organizador é obrigatório.' });
    }

    const offset = (page - 1) * limit;

    // Consulta de dados com paginação
    const dataSql = `
      SELECT u.id_usuario AS id,
             u.nome,
             u.email,
             u.tt,
             u.imagem_perfil
      FROM usuario u
      JOIN amizades a ON u.id_usuario = a.amigo_id
      WHERE a.organizador_id = $1
        AND (
          LOWER(u.nome) LIKE LOWER($2)
          OR LOWER(u.tt) LIKE LOWER($2)
          OR $2 = ''
        )
      ORDER BY u.nome
      LIMIT $3 OFFSET $4
    `;
    const dataValues = [organizador_id, `%${searchTerm}%`, limit, offset];
    const dataResult = await db.query(dataSql, dataValues);

    // Query separada para saber o total (contagem)
    const countSql = `
      SELECT COUNT(*) AS total
      FROM usuario u
      JOIN amizades a ON u.id_usuario = a.amigo_id
      WHERE a.organizador_id = $1
        AND (
          LOWER(u.nome) LIKE LOWER($2)
          OR LOWER(u.tt) LIKE LOWER($2)
          OR $2 = ''
        )
    `;
    const countResult = await db.query(countSql, [organizador_id, `%${searchTerm}%`]);
    const total = parseInt(countResult.rows[0]?.total ?? 0, 10);

    // Verifica se tem mais páginas disponíveis
    const hasMore = offset + dataResult.rows.length < total;

    // Retorna a lista e o hasMore
    return res.status(200).json({
      data: dataResult.rows || [],
      hasMore,
    });
  } catch (error) {
    console.error('Erro ao listar amigos:', error.message);
    return res.status(500).json({ message: 'Erro ao listar amigos.', error: error.message });
  }
});

// ==================================================================
// Buscar usuários pelo nome/tt
// Mesmo se já forem amigos, mostrará. Adicionamos "isfriend" (boolean).
// ==================================================================
router.get('/buscar', async (req, res) => {
  const { organizador_id, query } = req.query;

  if (!organizador_id || !query) {
    return res
      .status(400)
      .json({ message: 'Organizador e termo de busca são obrigatórios.' });
  }

  try {
    const sql = `
      SELECT 
        u.id_usuario AS id,
        u.nome,
        u.email,
        u.tt,
        u.imagem_perfil,
        CASE 
          WHEN a.amigo_id IS NOT NULL THEN true
          ELSE false
        END AS isfriend
      FROM usuario u
      -- Left join para verificar se o usuário é amigo
      LEFT JOIN amizades a
        ON a.amigo_id = u.id_usuario
       AND a.organizador_id = $2
      WHERE (LOWER(u.nome) LIKE LOWER($1)
             OR LOWER(u.tt) LIKE LOWER($1))
      ORDER BY u.nome
      LIMIT 10
    `;

    const values = [`%${query}%`, organizador_id];
    const result = await db.query(sql, values);

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar amigos:', error);
    return res.status(500).json({ message: 'Erro ao buscar amigos.' });
  }
});

// ==================================================================
// Equilibrar times com amigos selecionados
// (Exemplo simples, pode adaptar)
// ==================================================================
router.post('/equilibrar-amigos-selecionados', async (req, res) => {
  const { amigosSelecionados } = req.body;

  if (!amigosSelecionados || amigosSelecionados.length === 0) {
    return res.status(400).json({ message: 'Nenhum amigo selecionado.' });
  }

  try {
    const jogadores = await db.query(
      `SELECT u.id_usuario,
              u.nome,
              u.tt,
              COALESCE(a.passe, 0) AS passe,
              COALESCE(a.ataque, 0) AS ataque,
              COALESCE(a.levantamento, 0) AS levantamento
       FROM usuario u
       LEFT JOIN avaliacoes a
              ON u.id_usuario = a.usuario_id
       WHERE u.id_usuario = ANY($1)`,
      [amigosSelecionados]
    );

    if (jogadores.rows.length === 0) {
      return res.status(404).json({ message: 'Nenhum jogador encontrado.' });
    }

    const times = balancearTimes(jogadores.rows);
    return res.status(200).json({ times });
  } catch (error) {
    console.error('Erro ao equilibrar times:', error);
    return res.status(500).json({ message: 'Erro interno ao equilibrar times.' });
  }
});

// Função auxiliar para balancear times (exemplo simples)
function balancearTimes(jogadores) {
  // Ordena pelos somatórios das skills
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

// ==================================================================
// Atualizar frequência de interação com amigo
// ==================================================================
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
    return res.status(200).json({ message: 'Frequência atualizada com sucesso.' });
  } catch (error) {
    console.error('Erro ao atualizar frequência:', error);
    return res.status(500).json({ message: 'Erro ao atualizar frequência.' });
  }
});

// ==================================================================
// Listar amigos frequentes
// ==================================================================
router.get('/frequentes/:organizador_id', async (req, res) => {
  const { organizador_id } = req.params;

  try {
    const result = await db.query(
      `SELECT u.id_usuario AS id,
              u.nome,
              u.email,
              u.tt,
              af.frequencia
       FROM usuario u
       JOIN amigos_frequentes af
            ON u.id_usuario = af.amigo_id
       WHERE af.organizador_id = $1
       ORDER BY af.frequencia DESC`,
      [organizador_id]
    );

    if (result.rows.length === 0) {
      return res.status(200).json([]);
    }

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('Erro ao listar amigos frequentes:', error);
    return res.status(500).json({ message: 'Erro ao listar amigos frequentes.' });
  }
});

module.exports = router;
