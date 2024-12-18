const express = require('express');
const router = express.Router();
const pool = require('../../db'); // Conexão com o banco de dados

// Rota para buscar um convite pelo UUID (sem autenticação)
router.get('/:uuid', async (req, res) => {
  console.log("=== Rota GET /api/convites/:uuid chamada ===");

  const { uuid } = req.params;

  try {
    console.log("UUID recebido:", uuid);

    // Buscar o convite no banco de dados
    const { rows: convite } = await pool.query(
      `SELECT * FROM convites WHERE convite_uuid = $1`,
      [uuid]
    );

    if (convite.length === 0) {
      console.log("Convite não encontrado para UUID:", uuid);
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
const authMiddleware = require('../../middlewares/authMiddleware');
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

    // Criar um novo convite
    const { rows: novoConvite } = await pool.query(
      `INSERT INTO convites (id_jogo, id_usuario, status, data_envio)
       VALUES ($1, $2, 'pendente', NOW())
       RETURNING convite_uuid`,
      [id_jogo, id_usuario]
    );

    const convite_uuid = novoConvite[0].convite_uuid;
    const linkConvite = `jogatta://convite/${convite_uuid}`;
    console.log("Novo convite criado:", linkConvite);

    return res.status(201).json({
      message: "Convite criado com sucesso!",
      convite: linkConvite,
    });

  } catch (error) {
    console.error("Erro ao criar convite:", error.message || error);
    return res.status(500).json({ error: 'Erro interno ao criar convite.', details: error.message });
  }
});

module.exports = router;
