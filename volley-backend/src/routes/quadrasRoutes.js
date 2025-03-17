const express = require('express');
const router = express.Router();
const db = require('../db');

// ... outras rotas existentes ...

// [GET] /api/quadras/:id/horarios-config
router.get('/:id/horarios-config', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT horarios_config
       FROM quadras
       WHERE id_quadra = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Quadra não encontrada' });
    }

    res.json(result.rows[0].horarios_config);
  } catch (error) {
    console.error('Erro ao buscar configuração de horários:', error);
    res.status(500).json({ message: 'Erro ao buscar configuração de horários' });
  }
});

// [POST] /api/quadras/:id/horarios-config
router.post('/:id/horarios-config', async (req, res) => {
  try {
    const { id } = req.params;
    const horariosConfig = req.body;

    const result = await db.query(
      `UPDATE quadras
       SET horarios_config = $1
       WHERE id_quadra = $2
       RETURNING *`,
      [horariosConfig, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Quadra não encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar configuração de horários:', error);
    res.status(500).json({ message: 'Erro ao atualizar configuração de horários' });
  }
});

// [GET] /api/quadras/:id/horarios-disponiveis
router.get('/:id/horarios-disponiveis', async (req, res) => {
  try {
    const { id } = req.params;
    const { data } = req.query;

    if (!data) {
      return res.status(400).json({ message: 'Data é obrigatória' });
    }

    // Buscar configuração de horários da quadra
    const configResult = await db.query(
      `SELECT horarios_config
       FROM quadras
       WHERE id_quadra = $1`,
      [id]
    );

    if (configResult.rows.length === 0) {
      return res.status(404).json({ message: 'Quadra não encontrada' });
    }

    const horariosConfig = configResult.rows[0].horarios_config;
    const diaSemana = new Date(data).getDay(); // 0 = Domingo, 1 = Segunda, etc.

    // Buscar reservas existentes para o dia
    const reservasResult = await db.query(
      `SELECT horario_inicio, horario_fim
       FROM reservas
       WHERE id_quadra = $1
       AND data_reserva = $2
       AND status != 'rejeitada'`,
      [id, data]
    );

    // Criar array com todos os horários possíveis (6h às 22h)
    const horarios = Array.from({ length: 17 }, (_, i) => {
      const hora = i + 6;
      return `${hora.toString().padStart(2, '0')}:00`;
    });

    // Marcar cada horário como disponível ou não
    const horariosDisponiveis = horarios.map(horario => {
      // Verificar se o horário está configurado como disponível para este dia da semana
      const disponivelConfig = horariosConfig?.[diaSemana]?.[horario] ?? true;

      // Verificar se existe alguma reserva que conflita com este horário
      const temReserva = reservasResult.rows.some(reserva => {
        const inicio = reserva.horario_inicio;
        const fim = reserva.horario_fim;
        return horario >= inicio && horario < fim;
      });

      return {
        horario,
        disponivel: disponivelConfig && !temReserva
      };
    });

    res.json(horariosDisponiveis);
  } catch (error) {
    console.error('Erro ao buscar horários disponíveis:', error);
    res.status(500).json({ message: 'Erro ao buscar horários disponíveis' });
  }
});

// [POST] /api/quadras
router.post('/', async (req, res) => {
  try {
    const { 
      nome, 
      preco_hora, 
      descricao, 
      id_empresa,
      horarios_config 
    } = req.body;

    // Validações básicas
    if (!nome || !preco_hora || !id_empresa) {
      return res.status(400).json({ 
        message: 'Nome, preço por hora e ID da empresa são obrigatórios' 
      });
    }

    // Validar estrutura do horarios_config
    if (!horarios_config || typeof horarios_config !== 'object') {
      return res.status(400).json({ 
        message: 'Configuração de horários é obrigatória' 
      });
    }

    // Validar cada dia configurado
    for (const [dia, horarios] of Object.entries(horarios_config)) {
      // Dia deve ser um número entre 0 e 6
      if (isNaN(dia) || parseInt(dia) < 0 || parseInt(dia) > 6) {
        return res.status(400).json({
          message: 'Dia inválido na configuração de horários',
          details: `Dia "${dia}" não é um número válido entre 0 e 6`
        });
      }

      // Horários devem ser um objeto
      if (typeof horarios !== 'object') {
        return res.status(400).json({
          message: 'Formato inválido de horários',
          details: `Horários do dia ${dia} devem ser um objeto`
        });
      }

      // Validar formato de cada horário
      for (const [horario, disponivel] of Object.entries(horarios)) {
        if (!/^([0-1][0-9]|2[0-3]):00$/.test(horario)) {
          return res.status(400).json({
            message: 'Formato de horário inválido',
            details: `Horário "${horario}" não está no formato correto (HH:00)`
          });
        }

        if (typeof disponivel !== 'boolean') {
          return res.status(400).json({
            message: 'Valor de disponibilidade inválido',
            details: `Disponibilidade deve ser um booleano (true/false)`
          });
        }
      }
    }

    // Criar a quadra
    const result = await db.query(
      `INSERT INTO quadras (
        nome, 
        preco_hora, 
        descricao, 
        id_empresa, 
        horarios_config
      ) VALUES ($1, $2, $3, $4, $5) 
      RETURNING *`,
      [nome, preco_hora, descricao, id_empresa, horarios_config]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar quadra:', error);
    res.status(500).json({ message: 'Erro ao criar quadra' });
  }
});

module.exports = router; 