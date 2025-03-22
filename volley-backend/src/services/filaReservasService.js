const db = require('../config/db');

const filaReservasService = {
  // 1️⃣ Adiciona um organizador na fila
  async entrarNaFila(reserva_id, organizador_id) {
    try {
      await db.query(
        `INSERT INTO fila_reservas (reserva_id, organizador_id)
         VALUES ($1, $2)`,
        [reserva_id, organizador_id]
      );
      return { message: 'Organizador entrou na fila com sucesso' };
    } catch (error) {
      console.error('Erro ao inserir na fila:', error);
      throw error;
    }
  },

  // 2️⃣ Busca fila completa de uma reserva
  async buscarFila(reserva_id) {
    try {
      const result = await db.query(
        `SELECT fr.id, fr.organizador_id, u.nome, fr.data_entrada
         FROM fila_reservas fr
         JOIN usuario u ON u.id_usuario = fr.organizador_id
         WHERE fr.reserva_id = $1
         ORDER BY fr.data_entrada ASC`,
        [reserva_id]
      );
      return result.rows;
    } catch (error) {
      console.error('Erro ao buscar fila:', error);
      throw error;
    }
  },

  // 3️⃣ Remove um organizador da fila (após confirmar ou desistir)
  async removerDaFila(fila_id) {
    try {
      await db.query(
        `DELETE FROM fila_reservas WHERE id = $1`,
        [fila_id]
      );
      return { message: 'Organizador removido da fila' };
    } catch (error) {
      console.error('Erro ao remover da fila:', error);
      throw error;
    }
  },

  // 4️⃣ Busca o próximo organizador da fila
  async proximoOrganizador(reserva_id) {
    try {
      const result = await db.query(
        `SELECT fr.id, fr.organizador_id, u.nome
         FROM fila_reservas fr
         JOIN usuario u ON u.id_usuario = fr.organizador_id
         WHERE fr.reserva_id = $1
         ORDER BY fr.data_entrada ASC
         LIMIT 1`,
        [reserva_id]
      );
      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      console.error('Erro ao buscar próximo organizador:', error);
      throw error;
    }
  }
};

module.exports = filaReservasService;
