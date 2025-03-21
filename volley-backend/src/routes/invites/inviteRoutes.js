// /routes/inviteRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // Conexão com o banco de dados
const authMiddleware = require('../../middlewares/authMiddleware');
const { v4: uuidv4 } = require('uuid');

// Rota para buscar um convite pelo UUID ou ID numérico
router.get('/:identificador', async (req, res) => {
  console.log("=== Rota GET /api/convites/:identificador chamada ===");

  const { identificador } = req.params;

  try {
    console.log("Identificador recebido:", identificador);

    let query;
    let value;

    // Verifica se o identificador é um número ou um UUID
    if (/^\d+$/.test(identificador)) {
      query = `SELECT * FROM convites WHERE id_numerico = $1`;
      value = parseInt(identificador);
    } else {
      query = `SELECT * FROM convites WHERE convite_uuid = $1`;
      value = identificador;
    }

    // Buscar o convite no banco de dados
    const { rows: convite } = await pool.query(query, [value]);

    if (convite.length === 0) {
      console.log("Convite não encontrado para o identificador:", identificador);
      return res.status(404).json({ error: 'Convite não encontrado.' });
    }

    console.log("Convite encontrado:", convite[0]);

    // Retornar os dados do convite
    return res.status(200).json({
      message: 'Convite encontrado!',
      convite: convite[0],
    });
  } catch (error) {
    console.error("Erro ao buscar convite:", error.message || error);
    return res.status(500).json({ error: 'Erro interno ao processar convite.', details: error.message });
  }
});

// Rota para criar um novo convite (com autenticação)
router.post('/gerar', authMiddleware, async (req, res) => {
  console.log("=== Rota POST /api/convites/gerar chamada ===");

  const { id_jogo } = req.body;
  const id_usuario = req.user.id; // Usuário autenticado que está enviando o convite

  console.log("Dados recebidos:", { id_jogo, id_usuario });

  try {
    if (!id_jogo) {
      console.log("Erro: Dados insuficientes para criar um convite.");
      return res.status(400).json({ error: 'Dados insuficientes para criar um convite.' });
    }

    const convite_uuid = uuidv4();
    // Aqui, geramos um id_numerico de 6 dígitos
    const id_numerico = Math.floor(100000 + Math.random() * 900000);

    const { rows: novoConvite } = await pool.query(
      `INSERT INTO convites (id_jogo, id_usuario, status, data_envio, id_numerico, convite_uuid)
       VALUES ($1, $2, 'aberto', NOW(), $3, $4)
       RETURNING convite_uuid, id_numerico`,
      [id_jogo, id_usuario, id_numerico, convite_uuid]
    );

    const linkConvite = `jogatta://convite/${convite_uuid}`;

    console.log("Novo convite criado:", { link: linkConvite, id_numerico, convite_uuid });

    return res.status(201).json({
      message: "Convite criado com sucesso!",
      convite: {
        link: linkConvite,
        id_numerico,
        convite_uuid
      },
    });

  } catch (error) {
    console.error("Erro ao criar convite:", error.message || error);
    return res.status(500).json({ error: 'Erro interno ao criar convite.', details: error.message });
  }
});

module.exports = router;
