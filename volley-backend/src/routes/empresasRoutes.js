// src/routes/empresasRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../db');

// [POST] /api/empresas
router.post('/', async (req, res) => {
  try {
    const { nome, localizacao, contato } = req.body;
    // Se a coluna na tabela é "endereco", atribuímos localizacao a endereco.
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

// [GET] /api/empresas
// Se passar ?includeQuadras=true, retorna cada empresa com um array "quadras".
router.get('/', async (req, res) => {
  try {
    // Buscar empresas com informações básicas de quadras
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
                 'foto', q.foto
               )
             ) FILTER (WHERE q.id_quadra IS NOT NULL), '[]') as quadras
        FROM empresas e
        LEFT JOIN quadras q ON e.id_empresa = q.id_empresa
       GROUP BY e.id_empresa
       ORDER BY e.nome
    `);

    return res.json(result.rows.map(empresa => ({
      ...empresa,
      quadras: empresa.quadras === '[]' ? [] : empresa.quadras
    })));
  } catch (error) {
    console.error('Erro ao listar empresas:', error);
    return res.status(500).json({ message: 'Erro ao listar empresas', error: error.message });
  }
});

// [GET] /api/empresas/:id
// Retorna uma empresa (se existir) e suas quadras no campo "quadras"
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar a empresa pelo ID
    const empRes = await pool.query(
      'SELECT * FROM public.empresas WHERE id_empresa = $1',
      [id]
    );
    if (empRes.rows.length === 0) {
      return res.status(404).json({ message: 'Empresa não encontrada' });
    }
    const empresa = empRes.rows[0];

    // Buscar as quadras associadas à empresa – usando SELECT com as colunas desejadas
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
             foto
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

// [GET] /api/empresas/:id/quadras
router.get('/:id/quadras', async (req, res) => {
  try {
    const { id } = req.params;

    // Validar se o ID é um número válido
    if (!id || isNaN(id)) {
      return res.status(400).json({ 
        message: 'ID da empresa inválido',
        details: 'O ID da empresa deve ser um número válido'
      });
    }

    // Primeiro verifica se a empresa existe
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

    // Buscar todas as quadras dessa empresa
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
              foto
         FROM quadras
        WHERE id_empresa = $1
        ORDER BY nome`,
      [id]
    );

    // Log para debug
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

// [GET] /api/empresas/:id/stats
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const hoje = new Date().toISOString().split('T')[0];

    // Buscar estatísticas do dia
    const reservasHojeQuery = await pool.query(
      `SELECT COUNT(*) as total
       FROM reservas r
       JOIN quadras q ON r.id_quadra = q.id_quadra
       WHERE q.id_empresa = $1
       AND r.data_reserva = $2
       AND r.status = 'confirmada'`,
      [id, hoje]
    );

    // Calcular taxa de ocupação (horários reservados / horários totais)
    const taxaOcupacaoQuery = await pool.query(
      `WITH horarios_disponiveis AS (
         SELECT COUNT(*) * 17 as total_slots -- 17 horários por dia (6h às 22h)
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

    // Calcular receita mensal
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

// [GET] /api/empresas/:id/reservas/pendentes
router.get('/:id/reservas/pendentes', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
         r.*,
         j.nome_jogo,
         j.limite_jogadores,
         j.descricao as descricao_jogo,
         u.nome as nome_organizador,
         u.email as email_organizador,
         q.nome as nome_quadra,
         q.preco_hora
       FROM reservas r
       JOIN jogos j ON r.id_jogo = j.id_jogo
       JOIN usuario u ON j.id_usuario = u.id_usuario
       JOIN quadras q ON r.id_quadra = q.id_quadra
       WHERE q.id_empresa = $1
       AND r.status = 'pendente'
       ORDER BY r.data_reserva ASC, r.horario_inicio ASC`,
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar reservas pendentes:', error);
    res.status(500).json({ message: 'Erro ao buscar reservas pendentes' });
  }
});

module.exports = router;
