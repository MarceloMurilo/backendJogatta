// routes/groupRoutes.js

const express = require('express');
const router = express.Router();
const db = require('../db'); // Conexão com o banco de dados

// Criar grupo
router.post('/criar', async (req, res) => {
  const { organizador_id, nome_grupo } = req.body;
  if (!organizador_id || !nome_grupo) return res.status(400).json({ message: 'Organizador e nome do grupo são obrigatórios.' });
  try {
    const result = await db.query(
      `INSERT INTO grupos_amigos (organizador_id, nome_grupo, data_criacao)
       VALUES ($1, $2, NOW()) RETURNING *`,
      [organizador_id, nome_grupo]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar grupo:', error);
    res.status(500).json({ message: 'Erro ao criar grupo.' });
  }
});

// Adicionar amigo ao grupo
router.post('/adicionar-membro', async (req, res) => {
  const { id_grupo, amigo_id } = req.body;
  if (!id_grupo || !amigo_id) return res.status(400).json({ message: 'Grupo e amigo são obrigatórios.' });
  try {
    await db.query(
      `INSERT INTO grupo_membros (id_grupo, amigo_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [id_grupo, amigo_id]
    );
    res.status(200).json({ message: 'Amigo adicionado ao grupo com sucesso.' });
  } catch (error) {
    console.error('Erro ao adicionar amigo ao grupo:', error);
    res.status(500).json({ message: 'Erro ao adicionar amigo ao grupo.' });
  }
});

// Listar grupos de um organizador (com membros)
router.get('/listar/:organizador_id', async (req, res) => {
  const { organizador_id } = req.params;
  try {
    const gruposResult = await db.query(
      `SELECT id_grupo, nome_grupo, data_criacao
       FROM grupos_amigos
       WHERE organizador_id = $1`,
      [organizador_id]
    );

    const grupos = gruposResult.rows;

    for (const grupo of grupos) {
      const membrosResult = await db.query(
        `SELECT u.id_usuario AS id, u.nome, u.email, u.tt
         FROM usuario u
         JOIN grupo_membros gm ON u.id_usuario = gm.amigo_id
         WHERE gm.id_grupo = $1`,
        [grupo.id_grupo]
      );
      grupo.membros = membrosResult.rows;
    }

    res.status(200).json(grupos);
  } catch (error) {
    console.error('Erro ao listar grupos:', error);
    res.status(500).json({ message: 'Erro ao listar grupos.' });
  }
});

// Listar membros de um grupo
router.get('/membros/:id_grupo', async (req, res) => {
  const { id_grupo } = req.params;
  try {
    const result = await db.query(
      `SELECT u.id_usuario AS id, u.nome, u.email, u.tt
       FROM usuario u
       JOIN grupo_membros gm ON u.id_usuario = gm.amigo_id
       WHERE gm.id_grupo = $1`,
      [id_grupo]
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Erro ao listar membros do grupo:', error);
    res.status(500).json({ message: 'Erro ao listar membros do grupo.' });
  }
});

// Editar grupo
router.put('/editar/:id_grupo', async (req, res) => {
  const { id_grupo } = req.params;
  const { nome_grupo, membros } = req.body;

  if (!id_grupo || isNaN(id_grupo)) {
    return res.status(400).json({ message: 'ID do grupo inválido.' });
  }

  try {
    // Atualizar o nome do grupo, se fornecido
    if (nome_grupo) {
      await db.query(
        `UPDATE grupos_amigos SET nome_grupo = $1 WHERE id_grupo = $2`,
        [nome_grupo, id_grupo]
      );
    }

    if (membros && Array.isArray(membros)) {
      // Remover todos os membros atuais do grupo
      await db.query(`DELETE FROM grupo_membros WHERE id_grupo = $1`, [id_grupo]);

      // Adicionar novos membros ao grupo
      const insertPromises = membros.map((amigo_id) => {
        return db.query(
          `INSERT INTO grupo_membros (id_grupo, amigo_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [id_grupo, amigo_id]
        );
      });

      await Promise.all(insertPromises);
    }

    // Buscar o grupo atualizado com seus membros
    const grupoResult = await db.query(
      `SELECT id_grupo, nome_grupo, data_criacao
       FROM grupos_amigos
       WHERE id_grupo = $1`,
      [id_grupo]
    );

    const grupo = grupoResult.rows[0];
    if (!grupo) return res.status(404).json({ message: 'Grupo não encontrado.' });

    const membrosResult = await db.query(
      `SELECT u.id_usuario AS id, u.nome, u.email, u.tt
       FROM usuario u
       JOIN grupo_membros gm ON u.id_usuario = gm.amigo_id
       WHERE gm.id_grupo = $1`,
      [id_grupo]
    );
    grupo.membros = membrosResult.rows;

    res.status(200).json(grupo);
  } catch (error) {
    console.error('Erro ao editar grupo:', error);
    res.status(500).json({ message: 'Erro ao editar grupo.' });
  }
});

// Excluir grupo do banco de dados
router.delete('/excluir/:id_grupo', async (req, res) => {
  const { id_grupo } = req.params;

  if (!id_grupo || isNaN(id_grupo)) {
    return res.status(400).json({ error: 'ID do grupo inválido.' });
  }

  try {
    // Primeiro remover os membros do grupo
    await db.query(`DELETE FROM grupo_membros WHERE id_grupo = $1`, [id_grupo]);

    // Depois remover o grupo em si
    const result = await db.query(`DELETE FROM grupos_amigos WHERE id_grupo = $1 RETURNING *`, [id_grupo]);

    if (result.rowCount === 0) return res.status(404).json({ message: 'Grupo não encontrado.' });

    res.status(200).json({ message: 'Grupo excluído com sucesso.' });
  } catch (error) {
    console.error('Erro ao excluir grupo:', error);
    res.status(500).json({ message: 'Erro ao excluir grupo.' });
  }
});

module.exports = router;
