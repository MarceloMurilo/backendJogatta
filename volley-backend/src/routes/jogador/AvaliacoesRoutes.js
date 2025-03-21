// /routes/jogador/AvaliacoesRoutes.js

const express = require('express');
const router = express.Router();
const db = require('../../config/db'); // Conexão com o banco de dados
const authMiddleware = require('../../middlewares/authMiddleware');
const roleMiddleware = require('../../middlewares/roleMiddleware');

// Middleware para log de requisições (opcional)
router.use((req, res, next) => {
  console.log(`=== Nova requisição recebida ===`);
  console.log(`Método: ${req.method}`);
  console.log(`URL: ${req.originalUrl}`);
  console.log(`Body:`, req.body);
  console.log(`Params:`, req.params);
  console.log(`==============================`);
  next();
});

/**
 * Função para gerar um ID único dentro do intervalo de 32-bit integer.
 * Gera números entre 1 e 2,147,483,647.
 */
const gerarIdUnico = async () => {
  const MAX_INT = 2147483647;
  let idGerado;
  let tentativa = 0;
  const MAX_TENTATIVAS = 1000;

  do {
    idGerado = Math.floor(Math.random() * MAX_INT) + 1; // Gera entre 1 e 2147483647
    tentativa += 1;
    if (tentativa > MAX_TENTATIVAS) {
      throw new Error('Não foi possível gerar um ID único para o jogador temporário.');
    }

    // Verifica se o ID já existe na tabela usuario
    const result = await db.query('SELECT id_usuario FROM usuario WHERE id_usuario = $1', [idGerado]);
    if (result.rows.length === 0) {
      break; // ID único encontrado
    }
  } while (tentativa <= MAX_TENTATIVAS);

  return idGerado;
};

// Novo endpoint para criar jogador temporário
router.post(
  '/temporario',
  authMiddleware,
  roleMiddleware(['organizador']),
  async (req, res) => {
    const { nome } = req.body;

    if (!nome || nome.trim() === '') {
      return res.status(400).json({ message: 'Nome do jogador é obrigatório.' });
    }

    try {
      // Gera um ID único dentro do intervalo permitido
      const id_usuario = await gerarIdUnico();

      await db.query(
        `INSERT INTO usuario (id_usuario, nome, email, senha, imagem_perfil, temporario)
         VALUES ($1, $2, NULL, 'senha_temporaria', NULL, TRUE)
         ON CONFLICT (id_usuario) DO NOTHING;`,
        [id_usuario, nome.trim()]
      );

      console.log('Jogador temporário criado:', { id_usuario, nome: nome.trim() });
      res.status(201).json({ message: 'Jogador temporário criado com sucesso!', id_usuario, nome: nome.trim() });
    } catch (error) {
      console.error('Erro ao criar jogador temporário:', error);
      res.status(500).json({ message: 'Erro ao criar jogador temporário.' });
    }
  }
);

// Rota para salvar ou atualizar avaliações
router.post(
  '/salvar',
  authMiddleware,
  roleMiddleware(['organizador', 'jogador']),
  async (req, res) => {
    const { organizador_id, usuario_id, passe, ataque, levantamento, nome } = req.body;

    console.log('Dados recebidos para salvar avaliação:', { organizador_id, usuario_id, passe, ataque, levantamento, nome });

    if (!organizador_id || !usuario_id) {
      return res.status(400).json({ message: 'Organizador e Usuário são obrigatórios.' });
    }

    try {
      // Insere usuário temporário no banco, se necessário
      await db.query(
        `INSERT INTO usuario (id_usuario, nome, email, senha, imagem_perfil, temporario)
         VALUES ($1, $2, NULL, 'senha_temporaria', NULL, TRUE)
         ON CONFLICT (id_usuario) DO NOTHING;`,
        [usuario_id, nome || 'Usuário Temporário']
      );

      // Salva ou atualiza a avaliação do usuário
      const result = await db.query(
        `INSERT INTO avaliacoes (organizador_id, usuario_id, passe, ataque, levantamento)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (organizador_id, usuario_id)
         DO UPDATE SET passe = $3, ataque = $4, levantamento = $5`,
        [organizador_id, usuario_id, passe, ataque, levantamento]
      );

      console.log('Avaliação salva/atualizada com sucesso:', result.rowCount);
      res.status(200).json({ message: 'Avaliação salva ou atualizada com sucesso!' });
    } catch (error) {
      console.error('Erro ao salvar avaliação:', error);
      res.status(500).json({ message: 'Erro ao salvar avaliação.' });
    }
  }
);

// Rota para buscar avaliações feitas pelo organizador
router.get(
  '/organizador/:organizador_id',
  authMiddleware,
  roleMiddleware(['organizador', 'jogador'], { skipIdJogo: true }),
  async (req, res) => {
    const { organizador_id } = req.params;

    console.log('Recebendo requisição na rota de avaliações:');
    console.log('Organizador ID:', organizador_id);
    console.log('Usuário autenticado:', req.user);

    if (!organizador_id) {
      return res.status(400).json({ message: 'Organizador ID é obrigatório.' });
    }

    try {
      const result = await db.query(
        `SELECT usuario_id, passe, ataque, levantamento
         FROM avaliacoes
         WHERE organizador_id = $1`,
        [organizador_id]
      );

      console.log('Avaliações encontradas:', result.rows);
      res.status(200).json(result.rows);
    } catch (error) {
      console.error('Erro ao buscar avaliações:', error);
      res.status(500).json({ message: 'Erro ao buscar avaliações.' });
    }
  }
);

// Rota para buscar uma avaliação específica
router.get(
  '/:organizador_id/:usuario_id',
  authMiddleware,
  roleMiddleware(['organizador', 'jogador']),
  async (req, res) => {
    const { organizador_id, usuario_id } = req.params;

    console.log('Parâmetros recebidos para buscar avaliação específica:', { organizador_id, usuario_id });

    try {
      const result = await db.query(
        `SELECT usuario_id, passe, ataque, levantamento
         FROM avaliacoes
         WHERE organizador_id = $1 AND usuario_id = $2`,
        [organizador_id, usuario_id]
      );

      if (result.rows.length === 0) {
        console.log('Nenhuma avaliação encontrada para os parâmetros fornecidos.');
        return res.status(404).json({ message: 'Avaliação não encontrada.' });
      }

      console.log('Avaliação encontrada:', result.rows[0]);
      res.status(200).json(result.rows[0]);
    } catch (error) {
      console.error('Erro ao buscar avaliação específica:', error);
      res.status(500).json({ message: 'Erro ao buscar avaliação específica.' });
    }
  }
);

// Rota para listar todas as avaliações (caso precise retornar todas de uma vez)
router.get(
  '/organizador/:organizador_id/todas',
  authMiddleware,
  roleMiddleware(['organizador', 'jogador']),
  async (req, res) => {
    const { organizador_id } = req.params;

    console.log('Organizador ID recebido para listar todas as avaliações:', organizador_id);

    try {
      const result = await db.query(
        `SELECT usuario_id, passe, ataque, levantamento
         FROM avaliacoes
         WHERE organizador_id = $1`,
        [organizador_id]
      );

      console.log('Todas as avaliações encontradas:', result.rows);
      res.status(200).json(result.rows);
    } catch (error) {
      console.error('Erro ao listar todas as avaliações do organizador:', error);
      res.status(500).json({ message: 'Erro ao listar avaliações.' });
    }
  }
);

module.exports = router;
