// src/routes/userRoutes.js

const express = require('express');
const pool = require('../config/db');
const router = express.Router();

// Middleware para logar todas as requisições (opcional, se já estiver no server.js, pode remover)
router.use((req, res, next) => {
  console.log(`\n=== Nova requisição recebida ===`);
  console.log(`Método: ${req.method}`);
  console.log(`URL: ${req.url}`);
  console.log(`Body:`, req.body);
  console.log('==============================\n');
  next();
});

// Rota de teste dentro de userRoutes
router.get('/test', (req, res) => {
  res.json({ message: 'Rota de teste dentro de userRoutes funcionando!' });
});

// Rota para cadastrar um novo usuário (Create)
router.post('/', async (req, res) => {
  const { nome, email, senha, imagem_perfil, user_role, tt } = req.body; // Incluído campo 'tt'
  try {
    const result = await pool.query(
      'INSERT INTO public.usuario (nome, email, senha, imagem_perfil, user_role, tt) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [nome, email, senha, imagem_perfil, user_role, tt]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao cadastrar o usuário:', error);
    res.status(500).json({ error: 'Erro ao cadastrar o usuário', details: error.message });
  }
});

// Rota para listar todos os usuários (Read)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM public.usuario');
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Erro ao listar os usuários:', error);
    res.status(500).json({ error: 'Erro ao listar os usuários', details: error.message });
  }
});

// Rota para listar um único usuário por ID (Read)
router.get('/:id', async (req, res) => {
  const { id } = req.params; // ID do usuário a ser buscado
  const organizadorId = req.query.organizador_id; // ID do organizador enviado como parâmetro

  try {
    // Busca o usuário pelo ID
    const userResult = await pool.query('SELECT * FROM public.usuario WHERE id_usuario = $1', [id]);

    if (userResult.rows.length === 0) {
      console.log(`Usuário com ID ${id} não encontrado.`);
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const user = userResult.rows[0];

    // Adiciona o campo isfriend, verificando a relação no banco
    if (organizadorId) {
      const isFriendResult = await pool.query(
        `SELECT 
           CASE 
             WHEN EXISTS (
               SELECT 1 FROM amizades 
               WHERE organizador_id = $1 AND amigo_id = $2
             ) THEN true ELSE false
           END AS isfriend`,
        [organizadorId, id]
      );

      user.isfriend = isFriendResult.rows[0].isfriend;
    } else {
      user.isfriend = false; // Se o organizador_id não for passado, assume que não é amigo
    }

    console.log('Usuário encontrado:', user);
    res.status(200).json(user);
  } catch (error) {
    console.error('Erro ao buscar o usuário:', error);
    res.status(500).json({ error: 'Erro ao buscar o usuário', details: error.message });
  }
});

// Rota para atualizar um usuário por ID (Update)
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { nome, email, senha, imagem_perfil, user_role, tt } = req.body; // Incluído campo 'tt'
  try {
    const result = await pool.query(
      'UPDATE public.usuario SET nome = $1, email = $2, senha = $3, imagem_perfil = $4, user_role = $5, tt = $6 WHERE id_usuario = $7 RETURNING *',
      [nome, email, senha, imagem_perfil, user_role, tt, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar o usuário:', error);
    res.status(500).json({ error: 'Erro ao atualizar o usuário', details: error.message });
  }
});

// Rota para atualizar apenas o TT do usuário
router.put('/tt/:id', async (req, res) => {
  const { id } = req.params;
  const { tt } = req.body;
  try {
    const result = await pool.query(
      'UPDATE public.usuario SET tt = $1 WHERE id_usuario = $2 RETURNING *',
      [tt, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    res.status(200).json({ message: 'TT atualizado com sucesso!', usuario: result.rows[0] });
  } catch (error) {
    console.error('Erro ao atualizar o TT do usuário:', error);
    res.status(500).json({ error: 'Erro ao atualizar o TT do usuário', details: error.message });
  }
});

// Rota para atualizar apenas a foto de perfil do usuário
router.put('/:id/foto', async (req, res) => {
  const { id } = req.params; // ID do usuário a ser atualizado
  const { imagem_perfil } = req.body; // URL da nova foto de perfil

  try {
    // Atualiza a foto de perfil no banco de dados
    const result = await pool.query(
      'UPDATE public.usuario SET imagem_perfil = $1 WHERE id_usuario = $2 RETURNING *',
      [imagem_perfil, id]
    );

    // Verifica se o usuário existe
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Retorna o usuário atualizado
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar a foto de perfil:', error);
    res.status(500).json({
      error: 'Erro ao atualizar a foto de perfil',
      details: error.message,
    });
  }
});

// NOVA Rota para atualizar o device_token do usuário
router.put('/device-token', async (req, res) => {
  try {
    const { device_token } = req.body;
    const userId = req.user.id; // Supõe que o authMiddleware adiciona o usuário ao req.user

    if (!device_token) {
      return res.status(400).json({ error: 'device_token é obrigatório.' });
    }

    await pool.query(
      `UPDATE public.usuario
         SET device_token = $1
       WHERE id_usuario = $2`,
      [device_token, userId]
    );

    return res.status(200).json({ message: 'Token de notificação salvo com sucesso.' });
  } catch (error) {
    console.error('Erro ao salvar device_token:', error.message);
    return res.status(500).json({ error: 'Erro ao salvar device_token.', details: error.message });
  }
});

// Rota para deletar um usuário por ID (Delete)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Deletar participações do usuário em qualquer jogo
    await client.query('DELETE FROM public.game_participation WHERE id_usuario = $1', [id]);

    // Deletar convites onde o usuário é o convidado
    await client.query('DELETE FROM public.invites WHERE id_usuario_convidado = $1', [id]);

    // Deletar convites relacionados aos jogos criados pelo usuário
    await client.query(
      'DELETE FROM public.invites WHERE id_jogo IN (SELECT id_jogo FROM public.jogos WHERE id_usuario_criador = $1)',
      [id]
    );

    // Deletar reservas de quadra feitas pelo usuário
    await client.query('DELETE FROM public.court_reservations WHERE id_usuario = $1', [id]);

    // Deletar o usuário
    const result = await client.query('DELETE FROM public.usuario WHERE id_usuario = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    await client.query('COMMIT');
    res.status(200).json({ message: 'Usuário deletado com sucesso' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao deletar o usuário:', error);
    res.status(500).json({ error: 'Erro ao deletar o usuário', details: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
