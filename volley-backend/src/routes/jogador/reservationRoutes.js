// src/routes/jogador/reservationRoutes.js

const express = require('express');
const router = express.Router();
const db = require('../../db');

// Criar nova reserva
router.post('/', async (req, res) => {
  try {
    const {
      id_quadra,
      id_usuario,
      data_reserva,
      horario_inicio,
      horario_fim,
      status = 'pendente',
      quantidade_jogadores,
      reservation_price,
      id_jogo
    } = req.body;

    // Validação básica
    if (!id_quadra || !id_usuario || !data_reserva || !horario_inicio || !horario_fim) {
      return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
    }

    // (A) Checar conflito
    const conflictCheck = await db.query(
      `SELECT 1
         FROM reservas
        WHERE id_quadra = $1
          AND data_reserva = $2
          AND status NOT IN ('cancelada','rejeitada')
          AND ( (horario_inicio < $4 AND horario_fim > $3) )`,
      [id_quadra, data_reserva, horario_inicio, horario_fim]
    );
    if (conflictCheck.rowCount > 0) {
      return res.status(400).json({ error: 'Horário indisponível para esta quadra.' });
    }

    // (B) Verificar duração (máx 12h, opcional)
    const start = new Date(`${data_reserva}T${horario_inicio}`);
    const end = new Date(`${data_reserva}T${horario_fim}`);
    const diff = end - start;
    if (diff <= 0) {
      return res.status(400).json({ error: 'Horário de término deve ser após o horário de início.' });
    }
    if (diff > 12 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'A duração máxima da reserva é 12 horas.' });
    }

    // (C) Inserir reserva
    const result = await db.query(
      `INSERT INTO reservas (
         id_quadra,
         id_usuario,
         data_reserva,
         horario_inicio,
         horario_fim,
         status,
         quantidade_jogadores,
         reservation_price,
         id_jogo
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        id_quadra,
        id_usuario,
        data_reserva,
        horario_inicio,
        horario_fim,
        status,
        quantidade_jogadores || null,
        reservation_price || null,
        id_jogo || null
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('[reservationRoutes] Erro ao criar reserva:', error);
    res.status(500).json({ error: 'Erro ao criar reserva' });
  }
});

// NOVA ROTA: Buscar detalhes de uma reserva específica
router.get('/:id_reserva', async (req, res) => {
  try {
    const { id_reserva } = req.params;

    const result = await db.query(
      `SELECT r.*, q.nome as nome_quadra, e.nome as nome_empresa
         FROM reservas r
         JOIN quadras q ON r.id_quadra = q.id_quadra
         JOIN empresas e ON q.id_empresa = e.id_empresa
        WHERE r.id_reserva = $1`,
      [id_reserva]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Reserva não encontrada' });
    }
    
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('[reservationRoutes] Erro ao buscar reserva:', error);
    res.status(500).json({ error: 'Erro ao buscar reserva' });
  }
});

// Buscar reservas de uma quadra específica
router.get('/quadra/:id_quadra', async (req, res) => {
  try {
    const { id_quadra } = req.params;

    const result = await db.query(
      `SELECT r.*, u.nome as nome_usuario
         FROM reservas r
         JOIN usuario u ON r.id_usuario = u.id_usuario
        WHERE r.id_quadra = $1
        ORDER BY r.data_reserva, r.horario_inicio`,
      [id_quadra]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('[reservationRoutes] Erro ao buscar reservas:', error);
    res.status(500).json({ error: 'Erro ao buscar reservas' });
  }
});

// Atualizar status - MODIFICADO
router.put('/:id_reserva/status', async (req, res) => {
  try {
    const { id_reserva } = req.params;
    const { status, id_jogo } = req.body; // Agora aceita id_jogo no corpo

    // Log para debug
    console.log(`[reservationRoutes] Atualizando status da reserva ${id_reserva} para ${status}. ID do jogo: ${id_jogo || 'não informado'}`);

    // Se não veio id_jogo tenta buscá-lo
    let jogoId = id_jogo;
    if (!jogoId) {
      const reservaCheck = await db.query(
        `SELECT id_jogo FROM reservas WHERE id_reserva = $1`,
        [id_reserva]
      );
      
      if (reservaCheck.rowCount > 0 && reservaCheck.rows[0].id_jogo) {
        jogoId = reservaCheck.rows[0].id_jogo;
        console.log(`[reservationRoutes] ID do jogo encontrado na consulta: ${jogoId}`);
      }
    }

    const result = await db.query(
      `UPDATE reservas
         SET status = $1
       WHERE id_reserva = $2
       RETURNING *`,
      [status, id_reserva]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Reserva não encontrada' });
    }

    // Após atualizar com sucesso, tenta registrar uma notificação para o usuário
    try {
      // Buscar informações do usuário que fez a reserva e o jogo relacionado
      const reservaInfo = await db.query(
        `SELECT r.id_usuario, r.id_jogo, j.nome_jogo
           FROM reservas r
           LEFT JOIN jogos j ON r.id_jogo = j.id_jogo
          WHERE r.id_reserva = $1`,
        [id_reserva]
      );
      
      if (reservaInfo.rowCount > 0) {
        const { id_usuario, id_jogo, nome_jogo } = reservaInfo.rows[0];
        const jogoNome = nome_jogo || 'Reserva';
        
        // Registrar uma notificação no banco para o usuário
        await db.query(
          `INSERT INTO notificacoes (id_usuario, tipo, titulo, mensagem, status, data_criacao)
           VALUES ($1, $2, $3, $4, 'não_lida', NOW())`,
          [
            id_usuario, 
            status === 'aprovada' ? 'reserva_aprovada' : 'reserva_rejeitada',
            `Atualização de Reserva: ${jogoNome}`,
            status === 'aprovada' ? 
              `Sua reserva para ${jogoNome} foi aprovada!` : 
              `Sua reserva para ${jogoNome} foi rejeitada.`
          ]
        );
        
        console.log(`[reservationRoutes] Notificação enviada para usuário ${id_usuario} sobre reserva ${id_reserva}`);
      }
    } catch (notifError) {
      // Se falhar ao criar a notificação, apenas loga o erro mas continua o fluxo
      console.error('[reservationRoutes] Erro ao registrar notificação:', notifError);
    }
    
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('[reservationRoutes] Erro ao atualizar status da reserva:', error);
    res.status(500).json({ error: 'Erro ao atualizar status da reserva' });
  }
});

// Verificar disponibilidade
router.get('/disponibilidade/:id_quadra', async (req, res) => {
  try {
    const { id_quadra } = req.params;
    const { data } = req.query;

    if (!data) {
      return res.status(400).json({ error: 'Data é obrigatória para verificar disponibilidade.' });
    }

    const result = await db.query(
      `SELECT horario_inicio, horario_fim
         FROM reservas
        WHERE id_quadra = $1
          AND data_reserva = $2
          AND status NOT IN ('cancelada', 'rejeitada')
        ORDER BY horario_inicio`,
      [id_quadra, data]
    );

    // Retorna os intervalos ocupados. O front pode comparar com "horarios_config" da quadra
    return res.json(result.rows);
  } catch (error) {
    console.error('[reservationRoutes] Erro ao verificar disponibilidade:', error);
    res.status(500).json({ error: 'Erro ao verificar disponibilidade' });
  }
});

// NOVA ROTA: Obter status da reserva para um jogo específico
router.get('/jogo/:id_jogo/status', async (req, res) => {
  try {
    const { id_jogo } = req.params;
    
    const result = await db.query(
      `SELECT id_reserva, status, data_reserva, horario_inicio, horario_fim
         FROM reservas
        WHERE id_jogo = $1
        ORDER BY id_reserva DESC
        LIMIT 1`,
      [id_jogo]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Nenhuma reserva encontrada para este jogo' });
    }
    
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('[reservationRoutes] Erro ao buscar status da reserva:', error);
    res.status(500).json({ error: 'Erro ao buscar status da reserva' });
  }
});

module.exports = router;