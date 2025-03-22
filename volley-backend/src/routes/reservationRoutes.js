const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const filaReservasService = require('../../src/services/filaReservasService'); // Importa o service que criamos

// 1️⃣ Verificar disponibilidade de horário (como já estava)
router.get('/disponibilidade/:id_quadra', async (req, res) => {
  const { id_quadra } = req.params;
  const { data } = req.query;

  try {
    if (!data) {
      return res.status(400).json({ error: 'Data é obrigatória' });
    }

    const reservasExistentes = await db.query(
      `SELECT horario_inicio, horario_fim
       FROM reservas
       WHERE id_quadra = $1 
       AND data_reserva = $2
       AND status IN ('confirmada', 'pendente')
       ORDER BY horario_inicio`,
      [id_quadra, data]
    );

    const horarios = [];
    for (let hora = 6; hora <= 22; hora++) {
      const horaFormatada = hora.toString().padStart(2, '0') + ':00';
      horarios.push({
        horario: horaFormatada,
        disponivel: true
      });
    }

    reservasExistentes.rows.forEach(reserva => {
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
    console.error('Erro ao verificar disponibilidade:', error);
    res.status(500).json({ error: 'Erro ao verificar disponibilidade' });
  }
});

// 2️⃣ Criar nova reserva pendente
router.post('/criar', async (req, res) => {
  console.log('\n✅ [reservationRoutes] Chamada na ROTA POST /criar');
  console.log('➡️ Body recebido:', req.body);

  const { id_quadra, id_empresa, id_usuario, data_reserva, horario_inicio, horario_fim, quantidade_jogadores } = req.body;

  try {
    // Buscar configurações da quadra
    const quadraResult = await db.query(
      `SELECT preco_hora, percentual_antecipado, prazo_limite_confirmacao FROM quadras WHERE id_quadra = $1`,
      [id_quadra]
    );
    if (quadraResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quadra não encontrada' });
    }

    const quadra = quadraResult.rows[0];

    const valor_total = quadra.preco_hora; // Aqui você pode ajustar conforme lógica real
    const percentual = quadra.percentual_antecipado;
    const valor_minimo = (percentual / 100) * valor_total;

    // Calcula prazo de confirmação
    const prazo_confirmacao = new Date(data_reserva);
    prazo_confirmacao.setHours(horario_inicio.split(':')[0] - quadra.prazo_limite_confirmacao);

    // Cria reserva
    await db.query(
      `INSERT INTO reservas (id_quadra, id_empresa, id_usuario, data_reserva, horario_inicio, horario_fim, quantidade_jogadores, status_reserva, valor_pago, prazo_confirmacao, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente', 0, $8, 'pendente')`,
      [id_quadra, id_empresa, id_usuario, data_reserva, horario_inicio, horario_fim, quantidade_jogadores, prazo_confirmacao]
    );

    res.status(201).json({ message: 'Reserva criada com sucesso', valor_minimo });
  } catch (error) {
    console.error('Erro ao criar reserva:', error);
    res.status(500).json({ error: 'Erro ao criar reserva' });
  }
});

// 3️⃣ Organizador entra na fila
router.post('/entrar-fila', async (req, res) => {
  const { reserva_id, organizador_id } = req.body;

  try {
    // Verifica se reserva existe
    const reservaResult = await db.query(
      `SELECT * FROM reservas WHERE id_reserva = $1`,
      [reserva_id]
    );
    if (reservaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Reserva não encontrada' });
    }

    // Insere na fila
    await filaReservasService.entrarNaFila(reserva_id, organizador_id);

    res.status(201).json({ message: 'Organizador entrou na fila com sucesso' });
  } catch (error) {
    console.error('Erro ao entrar na fila:', error);
    res.status(500).json({ error: 'Erro ao entrar na fila' });
  }
});

// 4️⃣ Participante paga valor parcial
router.post('/pagar', async (req, res) => {
  const { reserva_id, valor_pago } = req.body;

  try {
    // Atualiza valor acumulado
    await db.query(
      `UPDATE reservas
       SET valor_pago = valor_pago + $1
       WHERE id_reserva = $2`,
      [valor_pago, reserva_id]
    );

    // Busca total pago e config da quadra
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

    // Se atingiu o mínimo → atualiza status_reserva para confirmada_parcial
    if (totalPago >= valorMinimo) {
      await db.query(
        `UPDATE reservas SET status_reserva = 'confirmada_parcial' WHERE id_reserva = $1`,
        [reserva_id]
      );
    }

    res.status(200).json({ message: 'Pagamento registrado com sucesso' });
  } catch (error) {
    console.error('Erro ao registrar pagamento:', error);
    res.status(500).json({ error: 'Erro ao registrar pagamento' });
  }
});

// 5️⃣ Dono envia ultimato (opcional, pra pressionar organizador)
router.post('/enviar-ultimato', async (req, res) => {
  const { reserva_id, prazo_horas } = req.body;

  try {
    // Atualiza o prazo de confirmação da reserva
    const novaData = new Date();
    novaData.setHours(novaData.getHours() + prazo_horas);

    await db.query(
      `UPDATE reservas SET prazo_confirmacao = $1 WHERE id_reserva = $2`,
      [novaData, reserva_id]
    );

    // Aqui podemos adicionar futura integração com notificação push

    res.status(200).json({ message: `Ultimato enviado: organizador tem até ${prazo_horas} horas` });
  } catch (error) {
    console.error('Erro ao enviar ultimato:', error);
    res.status(500).json({ error: 'Erro ao enviar ultimato' });
  }
});

module.exports = router;
