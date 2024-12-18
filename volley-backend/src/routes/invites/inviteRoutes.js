// Importando dependências
const express = require('express');
const router = express.Router();
const pool = require('../../db'); // Conexão com o banco de dados
const authMiddleware = require('../../middlewares/authMiddleware');

// Rota para criar um novo convite
router.post('/gerar', authMiddleware, async (req, res) => {
  console.log("=== Rota POST /api/convites/gerar chamada ===");

  const { id_jogo, id_usuario_convidado } = req.body;
  const id_usuario = req.user.id; // Usuário autenticado que está enviando o convite

  console.log("Dados recebidos:", { id_jogo, id_usuario_convidado, id_usuario });

  try {
    // Verificação dos dados recebidos
    if (!id_jogo || !id_usuario_convidado) {
      console.log("Erro: Dados insuficientes para criar um convite.");
      return res.status(400).json({ error: 'Dados insuficientes para criar um convite.' });
    }

    // Verificar se já existe um convite do mesmo usuário para o mesmo convidado e jogo
    const { rows: conviteExistente } = await pool.query(
      `SELECT convite_uuid FROM convites WHERE id_jogo = $1 AND id_usuario = $2 AND id_usuario_convidado = $3`,
      [id_jogo, id_usuario, id_usuario_convidado]
    );

    if (conviteExistente.length > 0) {
      const convite_uuid = conviteExistente[0].convite_uuid;
      const linkConvite = `jogatta://convite/${convite_uuid}`; // Usa o esquema do app
      console.log("Erro: Convite já existente. Retornando link existente:", linkConvite);

      return res.status(200).json({
        message: "Convite já existente!",
        convite: linkConvite
      });
    }

    // Criar um novo convite no banco de dados
    const { rows: novoConvite } = await pool.query(
      `INSERT INTO convites (id_jogo, id_usuario_convidado, id_usuario, status, data_envio)
       VALUES ($1, $2, $3, 'pendente', NOW())
       RETURNING convite_uuid`,
      [id_jogo, id_usuario_convidado, id_usuario]
    );

    // Gerar o link com base no UUID retornado
    const convite_uuid = novoConvite[0].convite_uuid;
    const linkConvite = `jogatta://convite/${convite_uuid}`;

    console.log("Convite criado com sucesso:", linkConvite);

    // Retornar o link do convite
    return res.status(201).json({
      message: "Convite criado com sucesso!",
      convite: linkConvite
    });

  } catch (error) {
    // Tratamento de erros
    console.error("Erro ao criar convite:", error.message || error);
    return res.status(500).json({ error: 'Erro interno ao criar convite.', details: error.message });
  }
});

module.exports = router;
