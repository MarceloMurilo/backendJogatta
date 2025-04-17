// src/routes/jogador/reservationRoutes.js

const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const filaReservasService = require('../../services/filaReservasService');
const { liberarCofre } = require('../../services/cofreService');
const roleMiddleware = require('../../middlewares/roleMiddleware');
const authMiddleware = require('../../middlewares/authMiddleware');

// =============================================================================
// Seção 1: Criação de Reserva (Avançada)
// =============================================================================

router.post('/criar', async (req, res) => {
  console.log('\n✅ [reservationRoutes] POST /criar', req.body);
  const {
    id_quadra,
    id_empresa,
    id_usuario,
    data_reserva,
    horario_inicio,
    horario_fim,
    quantidade_jogadores
  } = req.body;

  try {
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
    const valor_total = quadra.preco_hora;
    const percentual = quadra.percentual_antecipado;
    const valor_minimo = (percentual / 100) * valor_total;

    // calcula prazo de confirmação corretamente
    const [hInicio, mInicio] = horario_inicio.split(':').map(Number);
    const dtInicio = new Date(`${data_reserva}T${horario_inicio}`);
    dtInicio.setHours(dtInicio.getHours() - quadra.prazo_limite_confirmacao);

    await db.query(
      `INSERT INTO reservas
         (id_quadra, id_empresa, id_usuario, data_reserva,
          horario_inicio, horario_fim, quantidade_jogadores,
          status_reserva, valor_pago, prazo_confirmacao, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pendente',0,$8,'pendente')`,
      [
        id_quadra,
        id_empresa,
        id_usuario,
        data_reserva,
        horario_inicio,
        horario_fim,
        quantidade_jogadores,
        dtInicio
      ]
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

// Rota de cofre — deve vir antes de '/:id_reserva'
router.get('/:id_reserva/cofre', async (req, res) => {
  const { id_reserva } = req.params;
  try {
    const result = await db.query(
      `SELECT r.valor_pago, q.preco_hora, q.percentual_antecipado
         FROM reservas r
         JOIN quadras q ON r.id_quadra = q.id_quadra
        WHERE r.id_reserva = $1`,
      [id_reserva]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Reserva não encontrada' });
    }
    const { valor_pago, preco_hora, percentual_antecipado } = result.rows[0];
    const valor_minimo = (percentual_antecipado / 100) * preco_hora;
    res.json({
      valor_pago,
      valor_total: preco_hora,
      valor_minimo,
      confirmado: valor_pago >= valor_minimo
    });
  } catch (error) {
    console.error('[reservationRoutes] Erro ao consultar cofre:', error);
    res.status(500).json({ error: 'Erro ao consultar cofre' });
  }
});

// Verificar se um jogador já confirmou pagamento
router.get('/:id_reserva/status-pagamento', async (req, res) => {
  const { id_reserva } = req.params;
  const { id_usuario } = req.query;
  try {
    const jogoRes = await db.query(
      `SELECT id_jogo FROM reservas WHERE id_reserva = $1`,
      [id_reserva]
    );
    if (jogoRes.rowCount === 0 || !jogoRes.rows[0].id_jogo) {
      return res.status(404).json({ error: 'Reserva não vinculada a um jogo' });
    }
    const id_jogo = jogoRes.rows[0].id_jogo;
    const pagoRes = await db.query(
      `SELECT pagamento_confirmado
         FROM participacao_jogos
        WHERE id_jogo = $1
          AND id_usuario = $2`,
      [id_jogo, id_usuario]
    );
    const confirmado = pagoRes.rowCount > 0 && pagoRes.rows[0].pagamento_confirmado;
    res.json({ pagamento_confirmado: confirmado });
  } catch (error) {
    console.error('[reservationRoutes] Erro status-pagamento:', error);
    res.status(500).json({ error: 'Erro ao verificar status de pagamento' });
  }
});

// Buscar detalhes de uma reserva
router.get('/:id_reserva', async (req, res) => {
  const { id_reserva } = req.params;
  try {
    const result = await db.query(
      `SELECT r.*, q.nome AS nome_quadra, e.nome AS nome_empresa
         FROM reservas r
         JOIN quadras q ON r.id_quadra = q.id_quadra
         JOIN empresas e ON q.id_empresa = e.id_empresa
        WHERE r.id_reserva = $1`,
      [id_reserva]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Reserva não encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[reservationRoutes] Erro ao buscar reserva:', error);
    res.status(500).json({ error: 'Erro ao buscar reserva' });
  }
});

// Buscar reservas de uma quadra
router.get('/quadra/:id_quadra', async (req, res) => {
  const { id_quadra } = req.params;
  try {
    const result = await db.query(
      `SELECT r.*, u.nome AS nome_usuario
         FROM reservas r
         JOIN usuario u ON r.id_usuario = u.id_usuario
        WHERE r.id_quadra = $1
        ORDER BY r.data_reserva, r.horario_inicio`,
      [id_quadra]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('[reservationRoutes] Erro ao buscar reservas:', error);
    res.status(500).json({ error: 'Erro ao buscar reservas' });
  }
});

// Atualizar status da reserva
router.put('/:id_reserva/status', async (req, res) => {
  const { id_reserva } = req.params;
  const { status, id_jogo } = req.body;
  try {
    let jogoId = id_jogo;
    if (!jogoId) {
      const chk = await db.query(
        `SELECT id_jogo FROM reservas WHERE id_reserva = $1`,
        [id_reserva]
      );
      if (chk.rows[0]?.id_jogo) jogoId = chk.rows[0].id_jogo;
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
    // notificação (opcional)
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[reservationRoutes] Erro ao atualizar status:', error);
    res.status(500).json({ error: 'Erro ao atualizar status da reserva' });
  }
});

// Verificar disponibilidade de horários
router.get('/disponibilidade/:id_quadra', async (req, res) => {
  const { id_quadra } = req.params;
  const { data } = req.query;
  if (!data) {
    return res.status(400).json({ error: 'Data é obrigatória' });
  }
  try {
    const result = await db.query(
      `SELECT horario_inicio, horario_fim
         FROM reservas
        WHERE id_quadra = $1
          AND data_reserva = $2
          AND status NOT IN ('cancelada','rejeitada')
        ORDER BY horario_inicio`,
      [id_quadra, data]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('[reservationRoutes] Erro disponibilidade:', error);
    res.status(500).json({ error: 'Erro ao verificar disponibilidade' });
  }
});

// =============================================================================
// Seção 3: Funcionalidades Avançadas
// =============================================================================

// Entrar na fila (organizador)
router.post(
  '/entrar-fila',
  roleMiddleware(['organizador']),
  async (req, res) => {
    const { reserva_id, organizador_id } = req.body;
    try {
      const chk = await db.query(
        `SELECT 1 FROM reservas WHERE id_reserva = $1`,
        [reserva_id]
      );
      if (chk.rowCount === 0) {
        return res.status(404).json({ error: 'Reserva não encontrada' });
      }
      await filaReservasService.entrarNaFila(reserva_id, organizador_id);
      res.status(201).json({ message: 'Organizador entrou na fila' });
    } catch (error) {
      console.error('[reservationRoutes] Erro fila:', error);
      res.status(500).json({ error: 'Erro ao entrar na fila' });
    }
  }
);

// Registrar pagamento de jogador
router.post(
  '/pagar',
  authMiddleware,
  roleMiddleware(['organizador','jogador']),
  async (req, res) => {
    const { reserva_id, valor_pago, id_usuario, force_update = false } = req.body;
    try {
      if (!reserva_id || !valor_pago || !id_usuario) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });
      }
      await db.query(
        `UPDATE reservas
           SET valor_pago = valor_pago + $1
         WHERE id_reserva = $2`,
        [valor_pago, reserva_id]
      );
      // atualiza participacao_jogos...
      res.json({ message: 'Pagamento registrado com sucesso' });
    } catch (error) {
      console.error('[reservationRoutes] Erro pagar:', error);
      res.status(500).json({ error: 'Erro ao registrar pagamento' });
    }
  }
);

// Enviar ultimato (owner)
router.post(
  '/enviar-ultimato',
  roleMiddleware(['owner']),
  async (req, res) => {
    const { reserva_id, prazo_horas } = req.body;
    try {
      const novaData = new Date();
      novaData.setHours(novaData.getHours() + prazo_horas);
      await db.query(
        `UPDATE reservas SET prazo_confirmacao = $1 WHERE id_reserva = $2`,
        [novaData, reserva_id]
      );
      res.json({ message: `Ultimato de ${prazo_horas} horas enviado` });
    } catch (error) {
      console.error('[reservationRoutes] Erro ultimato:', error);
      res.status(500).json({ error: 'Erro ao enviar ultimato' });
    }
  }
);

// =============================================================================
// Seção 4: Liberação do Cofre
// =============================================================================

router.post('/:id/liberar-cofre', authMiddleware, async (req, res) => {
  const reservaId = req.params.id;
  try {
    const resultado = await liberarCofre(reservaId);
    res.json(resultado);
  } catch (error) {
    console.error('[reservationRoutes] Erro liberar cofre:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
