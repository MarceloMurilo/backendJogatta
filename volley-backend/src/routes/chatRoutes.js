const express = require('express');
const router = express.Router();
const db = require('../db'); // Conexão com o banco de dados

// Middleware para log de requisições
router.use((req, res, next) => {
  console.log(`=== Nova requisição recebida ===`);
  console.log(`Método: ${req.method}`);
  console.log(`URL: ${req.originalUrl}`);
  console.log(`Body:`, req.body);
  console.log(`Params:`, req.params);
  console.log(`==============================`);
  next();
});

// Rota para buscar mensagens de um chat
router.get('/:id_jogo', async (req, res) => {
  const { id_jogo } = req.params;

  if (!id_jogo) {
    return res.status(400).json({ message: 'ID do jogo é obrigatório.' });
  }

  try {
    const result = await db.query(
      `SELECT c.id, c.id_usuario, u.nome, c.conteudo, c.horario_envio
       FROM mensagens_chat c
       JOIN usuario u ON c.id_usuario = u.id_usuario
       WHERE c.id_jogo = $1
       ORDER BY c.horario_envio ASC`,
      [id_jogo]
    );

    // Retorna uma lista vazia se não houver mensagens
    res.status(200).json(result.rows.length > 0 ? result.rows : []);
  } catch (error) {
    console.error('Erro ao buscar mensagens do chat:', error);
    res.status(500).json({ message: 'Erro interno ao buscar mensagens.', error });
  }
});

// Rota para enviar uma mensagem no chat
router.post('/enviar', async (req, res) => {
  const { id_jogo, id_usuario, conteudo } = req.body;

  if (!id_jogo || !id_usuario || !conteudo) {
    return res.status(400).json({ message: 'Todos os campos são obrigatórios.' });
  }

  try {
    await db.query(
      `INSERT INTO mensagens_chat (id_jogo, id_usuario, conteudo, horario_envio)
       VALUES ($1, $2, $3, NOW())`,
      [id_jogo, id_usuario, conteudo]
    );

    res.status(201).json({ message: 'Mensagem enviada com sucesso.' });
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    res.status(500).json({ message: 'Erro interno ao enviar mensagem.', error });
  }
});

module.exports = router;
