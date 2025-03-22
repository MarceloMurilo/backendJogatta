const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const filaReservasService = require('../../src/services/filaReservasService'); // Lógica da fila
const roleMiddleware = require('../../middlewares/roleMiddleware');

// =============================================================================
// Seção 1: Criação de Reserva (Avançada)
// =============================================================================

router.post('/criar', async (req, res) => {
  console.log('\n✅ [reservationRoutes] Chamada na ROTA POST /criar');
  console.log('➡️ Body recebido:', req.body);

  const { id_quadra, id_empresa, id_usuario, data_reserva, horario_inicio, horario_fim, quantidade_jogadores } = req.body;

  try {
    // Buscar configurações da quadra
    const quadraResult = await db.query(
      `SELECT preco_hora, percentual_antecipado, prazo_limite_confirmacao 
         FROM quadras 
        WHERE id_quadra = $1`,
      [id_quadra]
    );
    if (quadraResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quadra não encontrada' });
    }

    const quadra = quadraResult.rows[0];
    const valor_total = quadra.preco_hora; // Ajustar conforme lógica real
    const percentual = quadra.percentual_antecipado;
    const valor_minimo = (percentual / 100) * valor_total;

    // Calcula prazo de confirmação (baseado no horário de início e prazo configurado)
    const prazo_confirmacao = new Date(data_reserva);
    prazo_confirmacao.setHours(horario_inicio.split(':')[0] - quadra.prazo_limite_confirmacao);

    // Cria a reserva com status e campos iniciais para o novo fluxo
    await db.query(
      `INSERT INTO reservas 
         (id_quadra, id_empresa, id_usuario, data_reserva, horario_inicio, horario_fim, quantidade_jogadores, status_reserva, valor_pago, prazo_confirmacao, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente', 0, $8, 'pendente')`,
      [id_quadra, id_empresa, id_usuario, data_reserva, horario_inicio, horario_fim, quantidade_jogadores, prazo_confirmacao]
    );

    res.status(201).json({ message: 'Reserva criada com sucesso', valor_minimo });
  } catch (error) {
    console.error('[reservationRoutes] Erro ao criar reserva:', error);
    res.status(500).json({ error: 'Erro ao criar reserva' });
  }
});

// =============================================================================
// Seção 2: Consultas e Atualizações Básicas
// =============================================================================

// Buscar detalhes de uma reserva específica
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

// Atualizar status da reserva (ex.: aprovada, rejeitada)
router.put('/:id_reserva/status', async (req, res) => {
  try {
    const { id_reserva } = req.params;
    const { status, id_jogo } = req.body;

    console.log(`[reservationRoutes] Atualizando status da reserva ${id_reserva} para ${status}. ID do jogo: ${id_jogo || 'não informado'}`);

    // Se id_jogo não foi informado, tenta buscar a partir da reserva
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

    // Tenta registrar uma notificação para o usuário da reserva
    try {
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
        await db.query(
          `INSERT INTO notificacoes 
             (id_usuario, tipo, titulo, mensagem, status, data_criacao)
           VALUES ($1, $2, $3, $4, 'não_lida', NOW())`,
          [
            id_usuario,
            status === 'aprovada' ? 'reserva_aprovada' : 'reserva_rejeitada',
            `Atualização de Reserva: ${jogoNome}`,
            status === 'aprovada'
              ? `Sua reserva para ${jogoNome} foi aprovada!`
              : `Sua reserva para ${jogoNome} foi rejeitada.`
          ]
        );
        console.log(`[reservationRoutes] Notificação enviada para usuário ${id_usuario} sobre reserva ${id_reserva}`);
      }
    } catch (notifError) {
      console.error('[reservationRoutes] Erro ao registrar notificação:', notifError);
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('[reservationRoutes] Erro ao atualizar status da reserva:', error);
    res.status(500).json({ error: 'Erro ao atualizar status da reserva' });
  }
});

// Verificar disponibilidade de horário para uma quadra
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
    return res.json(result.rows);
  } catch (error) {
    console.error('[reservationRoutes] Erro ao verificar disponibilidade:', error);
    res.status(500).json({ error: 'Erro ao verificar disponibilidade' });
  }
});

// Obter status da reserva para um jogo específico
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

// =============================================================================
// Seção 3: Funcionalidades Avançadas (Fila, Pagamento e Ultimato)
// =============================================================================

// Entrar na fila → apenas organizadores
router.post('/entrar-fila', roleMiddleware(['organizador']), async (req, res) => {
  const { reserva_id, organizador_id } = req.body;
  try {
    // Verifica se a reserva existe
    const reservaResult = await db.query(
      `SELECT * FROM reservas WHERE id_reserva = $1`,
      [reserva_id]
    );
    if (reservaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Reserva não encontrada' });
    }
    // Insere o organizador na fila usando o service
    await filaReservasService.entrarNaFila(reserva_id, organizador_id);
    res.status(201).json({ message: 'Organizador entrou na fila com sucesso' });
  } catch (error) {
    console.error('[reservationRoutes] Erro ao entrar na fila:', error);
    res.status(500).json({ error: 'Erro ao entrar na fila' });
  }
});

// Participante paga valor parcial → organizador ou jogador
router.post('/pagar', roleMiddleware(['organizador', 'jogador']), async (req, res) => {
  const { reserva_id, valor_pago } = req.body;
  try {
    // Atualiza o valor acumulado da reserva
    await db.query(
      `UPDATE reservas
         SET valor_pago = valor_pago + $1
       WHERE id_reserva = $2`,
      [valor_pago, reserva_id]
    );
    // Busca total pago e configurações da quadra para cálculo do valor mínimo
    const reservaResult = await db.query(
      `SELECT r.valor_pago, q.preco_hora, q.percentual_antecipado
         FROM reservas r
         JOIN quadras q ON q.id_quadra = r.id_quadra
        WHERE r.id_reserva = $1`,
      [reserva_id]
    );
    if (reservaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Reserva não encontrada' });
    }
    const { valor_pago: totalPago, preco_hora, percentual_antecipado } = reservaResult.rows[0];
    const valorMinimo = (percentual_antecipado / 100) * preco_hora;
    // Se o total pago atingir o valor mínimo, atualiza o status para 'confirmada_parcial'
    if (totalPago >= valorMinimo) {
      await db.query(
        `UPDATE reservas SET status_reserva = 'confirmada_parcial' WHERE id_reserva = $1`,
        [reserva_id]
      );
    }
    res.status(200).json({ message: 'Pagamento registrado com sucesso' });
  } catch (error) {
    console.error('[reservationRoutes] Erro ao registrar pagamento:', error);
    res.status(500).json({ error: 'Erro ao registrar pagamento' });
  }
});

// Dono envia ultimato para pressionar o organizador → somente dono
router.post('/enviar-ultimato', roleMiddleware(['owner']), async (req, res) => {
  const { reserva_id, prazo_horas } = req.body;
  try {
    // Atualiza o prazo de confirmação da reserva
    const novaData = new Date();
    novaData.setHours(novaData.getHours() + prazo_horas);
    await db.query(
      `UPDATE reservas SET prazo_confirmacao = $1 WHERE id_reserva = $2`,
      [novaData, reserva_id]
    );
    // Futura integração com notificações push pode ser adicionada aqui
    res.status(200).json({ message: `Ultimato enviado: organizador tem até ${prazo_horas} horas` });
  } catch (error) {
    console.error('[reservationRoutes] Erro ao enviar ultimato:', error);
    res.status(500).json({ error: 'Erro ao enviar ultimato' });
  }
});

module.exports = router;
