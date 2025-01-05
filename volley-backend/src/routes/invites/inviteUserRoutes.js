// /routes/inviteUserRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../../db'); // Conexão com o banco de dados
const authMiddleware = require('../../middlewares/authMiddleware');

// Rota para criar um novo convite
router.post('/', authMiddleware, async (req, res) => {
  console.log("=== Rota POST /api/convites chamada ===");

  const { id_jogo, id_usuario_convidado } = req.body;
  const id_usuario = req.user.id;
  console.log("Dados recebidos:", { id_jogo, id_usuario_convidado, id_usuario });

  try {
    if (!id_jogo || !id_usuario_convidado) {
      console.log("Erro: Dados insuficientes para criar um convite.");
      return res.status(400).json({ error: 'Dados insuficientes para criar um convite.' });
    }

    const result = await pool.query(
      `INSERT INTO convites (id_jogo, id_usuario_convidado, id_usuario, status, data_envio)
       VALUES ($1, $2, $3, 'aberto', NOW())
       RETURNING *`,
      [id_jogo, id_usuario_convidado, id_usuario]
    );

    console.log("Convite criado com sucesso:", result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Erro ao criar convite:", error);
    res.status(500).json({ error: 'Erro ao criar convite.' });
  }
});

// Rota para listar convites recebidos pelo usuário autenticado
router.get('/meus', authMiddleware, async (req, res) => {
  console.log("=== Rota GET /api/convites/meus chamada ===");

  const userId = req.user.id;
  console.log("ID do usuário autenticado:", userId);

  try {
    const result = await pool.query(
      `SELECT * FROM convites WHERE id_usuario_convidado = $1`,
      [userId]
    );

    console.log("Convites encontrados:", result.rows);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Nenhum convite recebido encontrado.' });
    }

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar convites recebidos:", error);
    res.status(500).json({ error: 'Erro ao buscar convites recebidos.' });
  }
});

// Rota para listar convites enviados pelo usuário autenticado
router.get('/enviados', authMiddleware, async (req, res) => {
  console.log("=== Rota GET /api/convites/enviados chamada ===");

  const userId = req.user.id;
  console.log("ID do usuário autenticado:", userId);

  try {
    const result = await pool.query(
      `SELECT * FROM convites WHERE id_usuario = $1`,
      [userId]
    );

    console.log("Convites enviados encontrados:", result.rows);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Nenhum convite enviado encontrado.' });
    }

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar convites enviados:", error);
    res.status(500).json({ error: 'Erro ao buscar convites enviados.' });
  }
});

module.exports = router;
