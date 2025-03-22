const db = require('../config/db');
const filaReservasService = require('../services/filaReservasService');

async function verificarReservasExpiradas() {
  try {
    console.log('🔍 Verificando reservas expiradas...');

    // Busca reservas pendentes cujo prazo já expirou
    const result = await db.query(
      `SELECT id_reserva FROM reservas
       WHERE status_reserva = 'pendente'
       AND prazo_confirmacao <= NOW()`
    );

    if (result.rows.length === 0) {
      console.log('✅ Nenhuma reserva expirada encontrada.');
      return;
    }

    for (const reserva of result.rows) {
      const { id_reserva } = reserva;

      console.log(`⚠️ Reserva expirada encontrada: ${id_reserva}`);

      // Busca próximo organizador da fila
      const proximo = await filaReservasService.proximoOrganizador(id_reserva);

      if (proximo) {
        console.log(`➡️ Passando para o próximo organizador: ${proximo.organizador_id}`);

        // Remove o organizador atual da fila
        await filaReservasService.removerDaFila(proximo.id);

        // Atualiza novo prazo para o próximo organizador (Ex: 12 horas pra ele)
        const novaData = new Date();
        novaData.setHours(novaData.getHours() + 12); // 12h ajustável

        await db.query(
          `UPDATE reservas SET prazo_confirmacao = $1 WHERE id_reserva = $2`,
          [novaData, id_reserva]
        );

        // FUTURA NOTIFICAÇÃO PUSH
        console.log(`📲 Notificação: Organizador ${proximo.nome} agora tem prioridade na reserva ${id_reserva}.`);

      } else {
        console.log(`❌ Nenhum organizador na fila. Liberando reserva ${id_reserva}.`);

        // Libera horário (remove reserva)
        await db.query(
          `DELETE FROM reservas WHERE id_reserva = $1`,
          [id_reserva]
        );

        console.log(`📢 Reserva ${id_reserva} liberada para outros interessados.`);
      }
    }

    console.log('✅ Verificação de reservas expiradas concluída.');
  } catch (error) {
    console.error('Erro ao verificar reservas expiradas:', error);
  }
}

module.exports = { verificarReservasExpiradas };
