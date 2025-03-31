// src/routes/empresasRoutes.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const ownerService = require('../services/ownerService');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); // Configuração básica para upload
const authMiddleware = require('../middlewares/authMiddleware');

/**
 * [POST] /api/empresas
 * Endpoint antigo para criação simples de empresa (sem senha, CNPJ etc.)
 * Pode ser mantido para compatibilidade se necessário.
 */
router.post('/', async (req, res) => {
  try {
    const { nome, localizacao, contato } = req.body;
    const endereco = localizacao;
    const result = await pool.query(
      `INSERT INTO public.empresas (nome, endereco, contato)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [nome, endereco, contato]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar empresa:', error);
    return res.status(500).json({
      message: 'Erro ao criar empresa',
      details: error.message,
    });
  }
});

/**
 * [POST] /api/empresas/cadastro
 * Novo endpoint para cadastro completo de empresa com senha, CNPJ, documento etc.
 * Este endpoint é utilizado para empresas (gestores) que se registram com dados completos.
 * Cria automaticamente um usuário gestor associado à empresa.
 */
router.post('/cadastro', upload.single('documento'), async (req, res) => {
  try {
    const { nome, endereco, contato, email_empresa, cnpj, senha } = req.body;
    const documento_url = req.file ? req.file.path : null;
    
    // Verificar se o email da empresa já está cadastrado para algum usuário
    const userCheck = await pool.query(
      'SELECT * FROM usuario WHERE email = $1',
      [email_empresa]
    );
    
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ 
        message: 'Email já registrado para outro usuário',
        details: 'Por favor, utilize um email diferente para a empresa.'
      });
    }
    
    // Primeiro criar um usuário gestor
    // Usando o email da empresa como email do usuário gestor
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(senha, 10);
    
    const userResult = await pool.query(
      'INSERT INTO usuario (nome, email, senha, papel_usuario) VALUES ($1, $2, $3, $4) RETURNING *',
      [nome, email_empresa, hashedPassword, 'gestor']
    );
    
    const novoGestor = userResult.rows[0];
    console.log('Novo usuário gestor criado:', novoGestor);
    
    // Agora criar a empresa associada ao gestor
    const novaEmpresa = await ownerService.createGestorEmpresa({
      nome,
      endereco,
      contato,
      email_empresa,
      cnpj,
      senha,
      documento_url
    }, novoGestor.id_usuario);

    // Gerar token JWT para o usuário recém-criado
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      {
        id: novoGestor.id_usuario,
        papel_usuario: novoGestor.papel_usuario,
        nome: novoGestor.nome,
        email: novoGestor.email
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    return res.status(201).json({
      message: 'Empresa cadastrada com sucesso. Aguardando aprovação.',
      empresa: novaEmpresa,
      gestor: {
        id: novoGestor.id_usuario,
        nome: novoGestor.nome,
        email: novoGestor.email
      },
      token // Token JWT para autenticação imediata
    });
  } catch (error) {
    console.error('Erro ao cadastrar empresa:', error);
    return res.status(500).json({ 
      message: 'Erro ao cadastrar empresa', 
      details: error.message 
    });
  }
});

/**
 * [PATCH] /api/empresas/:id/aprovar
 * Endpoint para aprovação manual de empresa (muda status de 'pendente' para 'ativo').
 * Apenas o superadmin deverá ter acesso a essa rota.
 */
router.patch('/:id/aprovar', async (req, res) => {
  try {
    const { id } = req.params;
    const empresaAprovada = await ownerService.aprovarEmpresa(id);
    if (!empresaAprovada) {
      return res.status(404).json({ message: 'Empresa não encontrada' });
    }
    return res.json({ 
      message: 'Empresa aprovada com sucesso', 
      empresa: empresaAprovada 
    });
  } catch (error) {
    console.error('Erro ao aprovar empresa:', error);
    return res.status(500).json({ 
      message: 'Erro ao aprovar empresa', 
      details: error.message 
    });
  }
});

/**
 * [GET] /api/empresas
 * Retorna a lista de empresas, incluindo (por agregação) as quadras associadas.
 */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
            SELECT e.*,
                   COALESCE(json_agg(
                     json_build_object(
                       'id', q.id_quadra,
                       'nome', q.nome,
                       'preco_hora', q.preco_hora,
                       'promocao_ativa', q.promocao_ativa,
                       'descricao_promocao', q.descricao_promocao,
                       'rede_disponivel', q.rede_disponivel,
                       'bola_disponivel', q.bola_disponivel,
                       'observacoes', q.observacoes,
                      'foto', q.foto,
                       'hora_abertura', q.hora_abertura,
                       'hora_fechamento', q.hora_fechamento
                     )
                   ) FILTER (WHERE q.id_quadra IS NOT NULL), '[]') as quadras
              FROM empresas e
              LEFT JOIN quadras q ON e.id_empresa = q.id_empresa
              WHERE e.status IN ('ativo', 'pendente')
             GROUP BY e.id_empresa
             ORDER BY e.nome
          `);
    // Caso a agregação retorne a string '[]', converte para array vazio
    return res.json(result.rows.map(empresa => ({
      ...empresa,
      quadras: empresa.quadras === '[]' ? [] : empresa.quadras
    })));
  } catch (error) {
    console.error('Erro ao listar empresas:', error);
    return res.status(500).json({ 
      message: 'Erro ao listar empresas', 
      error: error.message 
    });
  }
});

/**
 * [GET] /api/empresas/:id
 * Retorna dados de uma empresa específica e suas quadras.
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const empRes = await pool.query(
      'SELECT * FROM public.empresas WHERE id_empresa = $1',
      [id]
    );
    if (empRes.rows.length === 0) {
      return res.status(404).json({ message: 'Empresa não encontrada' });
    }
    const empresa = empRes.rows[0];
    const quadRes = await pool.query(`
      SELECT id_quadra,
             id_empresa,
             nome,
             preco_hora,
             promocao_ativa,
             descricao_promocao,
             rede_disponivel,
             bola_disponivel,
             observacoes,
             foto,
             hora_abertura,
             hora_fechamento
        FROM public.quadras
       WHERE id_empresa = $1
    `, [id]);
    empresa.quadras = quadRes.rows;
    return res.json(empresa);
  } catch (error) {
    console.error('Erro ao buscar empresa e quadras:', error);
    return res.status(500).json({ message: 'Erro ao buscar empresa e quadras' });
  }
});

/**
 * [GET] /api/empresas/:id/quadras
 * Retorna apenas as quadras de uma empresa.
 * Valida se o id é numérico e se a empresa existe.
 */
router.get('/:id/quadras', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(id)) {
      return res.status(400).json({ 
        message: 'ID da empresa inválido',
        details: 'O ID da empresa deve ser um número válido'
      });
    }
    const empresaExists = await pool.query(
      'SELECT 1 FROM empresas WHERE id_empresa = $1',
      [id]
    );
    if (empresaExists.rowCount === 0) {
      return res.status(404).json({ 
        message: 'Empresa não encontrada',
        details: 'Não existe empresa com o ID fornecido'
      });
    }
    const quadRes = await pool.query(
      `SELECT id_quadra,
              id_empresa,
              nome,
              preco_hora,
              promocao_ativa,
              descricao_promocao,
              rede_disponivel,
              bola_disponivel,
              observacoes,
              foto,
              hora_abertura,
              hora_fechamento
         FROM quadras
        WHERE id_empresa = $1
        ORDER BY nome`,
      [id]
    );
    console.log(`Buscando quadras para empresa ${id}:`, quadRes.rows);
    return res.status(200).json(quadRes.rows);
  } catch (error) {
    console.error('Erro ao buscar quadras da empresa:', error);
    return res.status(500).json({ 
      message: 'Erro ao buscar quadras',
      details: error.message
    });
  }
});

/**
 * [POST] /api/empresas/:id/quadras
 * Cria uma nova quadra associada a uma empresa específica.
 */
router.post('/:id/quadras', async (req, res) => {
  try {
    const { id } = req.params; // id da empresa
    const { nome, foto, preco_hora, promocao_ativa, descricao_promocao, rede_disponivel, bola_disponivel, observacoes, capacidade, hora_abertura, hora_fechamento } = req.body;

    // Validações básicas
    if (!nome || !preco_hora || !capacidade || !hora_abertura || !hora_fechamento) {
      return res.status(400).json({ 
        message: 'Campos obrigatórios (nome, preço por hora, capacidade, horários) não preenchidos.' 
      });
    }

    // Criação da quadra associada à empresa com id = id
    const result = await pool.query(
      `INSERT INTO quadras (
        nome, 
        foto, 
        preco_hora, 
        promocao_ativa, 
        descricao_promocao, 
        rede_disponivel, 
        bola_disponivel, 
        observacoes, 
        capacidade, 
        hora_abertura, 
        hora_fechamento, 
        id_empresa
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [nome, foto, preco_hora, promocao_ativa, descricao_promocao, rede_disponivel, bola_disponivel, observacoes, capacidade, hora_abertura, hora_fechamento, id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar quadra:', error);
    res.status(500).json({ message: 'Erro ao criar quadra', details: error.message });
  }
});

/**
 * [GET] /api/empresas/usuario/:id
 * Retorna a empresa vinculada a um usuário específico (gestor).
 * Essa rota é utilizada para carregar automaticamente os dados da empresa
 * após o login de um usuário com papel de gestor, com base no seu ID.
 */
router.get('/usuario/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT e.*
      FROM usuario_empresa ue
      JOIN empresas e ON ue.id_empresa = e.id_empresa
      WHERE ue.id_usuario = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Nenhuma empresa encontrada para este usuário' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('[Rota GET /usuario/:id] Erro ao buscar empresa por usuário:', error);
    return res.status(500).json({ 
      message: 'Erro ao buscar empresa por usuário', 
      details: error.message 
    });
  }
});

/**
 * [GET] /api/empresas/:id/stats
 * Retorna estatísticas da empresa, como reservas do dia, taxa de ocupação e receita mensal.
 */
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const hoje = new Date().toISOString().split('T')[0];
    const reservasHojeQuery = await pool.query(
      `SELECT COUNT(*) as total
       FROM reservas r
       JOIN quadras q ON r.id_quadra = q.id_quadra
       WHERE q.id_empresa = $1
       AND r.data_reserva = $2
       AND r.status = 'confirmada'`,
      [id, hoje]
    );
    const taxaOcupacaoQuery = await pool.query(
      `WITH horarios_disponiveis AS (
         SELECT COUNT(*) * 17 as total_slots
         FROM quadras
         WHERE id_empresa = $1
       ),
       horarios_ocupados AS (
         SELECT COUNT(*) as slots_ocupados
         FROM reservas r
         JOIN quadras q ON r.id_quadra = q.id_quadra
         WHERE q.id_empresa = $1
         AND r.data_reserva = $2
         AND r.status = 'confirmada'
       )
       SELECT 
         CASE 
           WHEN hd.total_slots > 0 
           THEN ROUND((ho.slots_ocupados::float / hd.total_slots::float) * 100)
           ELSE 0
         END as taxa_ocupacao
       FROM horarios_disponiveis hd, horarios_ocupados ho`,
      [id, hoje]
    );
    const primeiroDiaMes = new Date();
    primeiroDiaMes.setDate(1);
    const receitaMensalQuery = await pool.query(
      `SELECT COALESCE(SUM(q.preco_hora), 0) as receita_mensal
       FROM reservas r
       JOIN quadras q ON r.id_quadra = q.id_quadra
       WHERE q.id_empresa = $1
       AND r.data_reserva >= $2
       AND r.status = 'confirmada'`,
      [id, primeiroDiaMes.toISOString().split('T')[0]]
    );
    res.json({
      reservas_hoje: parseInt(reservasHojeQuery.rows[0].total),
      taxa_ocupacao: parseInt(taxaOcupacaoQuery.rows[0].taxa_ocupacao),
      receita_mensal: parseFloat(receitaMensalQuery.rows[0].receita_mensal)
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({ message: 'Erro ao buscar estatísticas' });
  }
});

/**
 * [GET] /api/empresas/:id/reservas/pendentes
 * Retorna reservas pendentes para a empresa, formatando os dados conforme necessário.
 */
router.get('/:id/reservas/pendentes', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT 
         r.id_reserva,
         r.data_reserva,
         r.horario_inicio,
         r.horario_fim,
         r.status,
         j.id_jogo,
         j.nome_jogo,
         j.limite_jogadores,
         j.descricao as descricao_jogo,
         u.id_usuario,
         u.nome as nome_organizador,
         u.email as email_organizador,
         q.id_quadra,
         q.nome as nome_quadra,
         q.preco_hora,
         q.tipo_quadra
       FROM reservas r
       LEFT JOIN jogos j ON r.id_jogo = j.id_jogo
       LEFT JOIN usuario u ON j.id_usuario = u.id_usuario
       LEFT JOIN quadras q ON r.id_quadra = q.id_quadra
       WHERE q.id_empresa = $1
       AND r.status = 'pendente'
       ORDER BY r.data_reserva ASC, r.horario_inicio ASC`,
      [id]
    );
    const reservasFormatadas = result.rows.map(row => ({
      id: row.id_reserva,
      data: row.data_reserva,
      horario_inicio: row.horario_inicio,
      horario_fim: row.horario_fim,
      status: row.status,
      jogo: {
        id: row.id_jogo,
        nome_jogo: row.nome_jogo || `Reserva #${row.id_reserva}`,
        limite_jogadores: row.limite_jogadores,
        descricao: row.descricao_jogo
      },
      organizador: {
        id: row.id_usuario,
        nome: row.nome_organizador,
        email: row.email_organizador
      },
      quadra: {
        id: row.id_quadra,
        nome: row.nome_quadra,
        preco_hora: row.preco_hora,
        tipo: row.tipo_quadra
      }
    }));
    res.json(reservasFormatadas);
  } catch (error) {
    console.error('Erro ao buscar reservas pendentes:', error);
    res.status(500).json({ message: 'Erro ao buscar reservas pendentes' });
  }
});

module.exports = router;
