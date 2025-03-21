// src/routes/jogador/jogoRapido.js

const express = require('express');
const router = express.Router();
const db = require('../../config/db'); // Conexão com o banco de dados

// Rota para criar jogo rápido
router.post('/criar-rapido', async (req, res) => {
  const { id_usuario, nome_jogo } = req.body;

  if (!id_usuario) {
    return res.status(400).json({ message: 'ID do usuário criador é obrigatório.' });
  }

  try {
    const nomePartida = nome_jogo || 'Partida Rápida';

    // Insere jogo apenas com nome_jogo e id_usuario (sem data_jogo, pois não existe mais)
    const result = await db.query(
      `INSERT INTO jogos (nome_jogo, id_usuario)
       VALUES ($1, $2)
       RETURNING id_jogo`,
      [nomePartida, id_usuario]
    );

    const id_jogo = result.rows[0].id_jogo;

    return res.status(201).json({
      message: 'Jogo rápido criado com sucesso.',
      id_jogo
    });
  } catch (error) {
    console.error('Erro ao criar jogo rápido:', error);
    res.status(500).json({ message: 'Erro interno ao criar jogo rápido.', error });
  }
});

module.exports = router;
