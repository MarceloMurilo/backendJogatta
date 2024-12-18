const express = require('express');
const router = express.Router();
const db = require('../../db'); // Importa a conexão com o banco de dados

// Rota para criar jogo rápido
router.post('/criar-rapido', async (req, res) => {
  const { id_usuario, nome_jogo } = req.body;

  // Verifica se o organizador foi fornecido
  if (!id_usuario) {
    return res.status(400).json({ message: 'ID do usuário criador é obrigatório.' });
  }

  try {
    // Define o nome padrão para jogos rápidos, caso não seja fornecido
    const nomePartida = nome_jogo || 'Partida Rápida';

    // Insere o jogo rápido no banco de dados
    const result = await db.query(
      `INSERT INTO jogos (nome_jogo, data_jogo, id_usuario)
       VALUES ($1, NOW(), $2) RETURNING id_jogo`,
      [nomePartida, id_usuario]
    );

    const id_jogo = result.rows[0].id_jogo;

    res.status(201).json({
      message: 'Jogo rápido criado com sucesso.',
      id_jogo,
    });
  } catch (error) {
    console.error('Erro ao criar jogo rápido:', error);
    res.status(500).json({ message: 'Erro interno ao criar jogo rápido.', error });
  }
});

module.exports = router;
