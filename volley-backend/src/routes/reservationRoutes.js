// Verificar disponibilidade de horário
router.get('/disponibilidade/:id_quadra', async (req, res) => {
  const { id_quadra } = req.params;
  const { data } = req.query;

  try {
    // Primeiro, verificar se a data é válida
    if (!data) {
      return res.status(400).json({ error: 'Data é obrigatória' });
    }

    // Buscar todas as reservas para esta quadra na data especificada
    const reservasExistentes = await db.query(
      `SELECT horario_inicio, horario_fim
       FROM reservas
       WHERE id_quadra = $1 
       AND data_reserva = $2
       AND status IN ('confirmada', 'pendente')
       ORDER BY horario_inicio`,
      [id_quadra, data]
    );

    // Criar array com todos os horários possíveis (6h às 22h)
    const horarios = [];
    for (let hora = 6; hora <= 22; hora++) {
      const horaFormatada = hora.toString().padStart(2, '0') + ':00';
      horarios.push({
        horario: horaFormatada,
        disponivel: true
      });
    }

    // Marcar horários já reservados como indisponíveis
    reservasExistentes.rows.forEach(reserva => {
      const inicio = parseInt(reserva.horario_inicio.split(':')[0]);
      const fim = parseInt(reserva.horario_fim.split(':')[0]);

      for (let hora = inicio; hora < fim; hora++) {
        const index = hora - 6; // 6h é o primeiro horário (índice 0)
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