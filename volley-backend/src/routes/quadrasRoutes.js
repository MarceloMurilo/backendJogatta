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
      return res.status(404).json({ error: 'Quadra não encontrada' });
    }

    res.json(result.rows[0].horarios_config || {});
  } catch (error) {
    console.error('Erro ao buscar configuração de horários:', error);
    res.status(500).json({ error: 'Erro ao buscar configuração de horários' });
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
      return res.status(404).json({ error: 'Quadra não encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao salvar configuração de horários:', error);
    res.status(500).json({ error: 'Erro ao salvar configuração de horários' });
  }
});

// [GET] /api/quadras/:id/horarios-disponiveis
router.get('/:id/horarios-disponiveis', async (req, res) => {
  try {
    const { id } = req.params;
    const { data } = req.query;

    if (!data) {
      return res.status(400).json({ error: 'Data é obrigatória' });
    }

    // Buscar configuração de horários da quadra
    const configResult = await db.query(
      `SELECT horarios_config
       FROM quadras
       WHERE id_quadra = $1`,
      [id]
    );

    if (configResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quadra não encontrada' });
    }

    const horariosConfig = configResult.rows[0].horarios_config || {};
    const diaSemana = new Date(data).getDay();
    const horariosPermitidos = horariosConfig[diaSemana] || {};

    // Buscar reservas existentes
    const reservasResult = await db.query(
      `SELECT horario_inicio, horario_fim
       FROM reservas
       WHERE id_quadra = $1 
       AND data_reserva = $2
       AND status IN ('confirmada', 'pendente')
       ORDER BY horario_inicio`,
      [id, data]
    );

    // Criar array com todos os horários possíveis (6h às 22h)
    const horarios = [];
    for (let hora = 6; hora <= 22; hora++) {
      const horaStr = hora.toString().padStart(2, '0') + ':00';
      horarios.push({
        horario: horaStr,
        disponivel: horariosPermitidos[horaStr] === true
      });
    }

    // Marcar horários já reservados como indisponíveis
    reservasResult.rows.forEach(reserva => {
      const inicio = parseInt(reserva.horario_inicio.split(':')[0]);
      const fim = parseInt(reserva.horario_fim.split(':')[0]);

      for (let hora = inicio; hora < fim; hora++) {
        const index = hora - 6;
        if (index >= 0 && index < horarios.length) {
          horarios[index].disponivel = false;
        }
      }
    });

    res.json(horarios);
  } catch (error) {
    console.error('Erro ao buscar horários disponíveis:', error);
    res.status(500).json({ error: 'Erro ao buscar horários disponíveis' });
  }
});

module.exports = router; 