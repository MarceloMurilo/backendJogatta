// services/cofreService.js

const db = require("../config/db");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Atualiza status do Cofre (reserva) e libera repasse
async function liberarCofre(reservaId) {
    try {
        // Buscar dados da reserva + empresa
        const reservaResult = await db.query(`
            SELECT r.*, e.stripe_account_id, r.valor_pago
            FROM reservas r
            JOIN quadras q ON r.id_quadra = q.id_quadra
            JOIN empresas e ON q.id_empresa = e.id_empresa
            WHERE r.id_reserva = $1
        `, [reservaId]);

        if (reservaResult.rowCount === 0) {
            throw new Error("Reserva não encontrada.");
        }

        const reserva = reservaResult.rows[0];

        // Verifica se já está liberado
        if (reserva.status_cofre === 'liberado') {
            throw new Error("Cofre já liberado para esta reserva.");
        }

        // Realiza o repasse via Stripe Transfer
        await stripe.transfers.create({
            amount: Math.floor(reserva.valor_pago * 100), // valor já pago
            currency: "brl",
            destination: reserva.stripe_account_id,
            description: `Repasse Cofre - Reserva ${reservaId}`
        });

        // Atualiza status_cofre
        await db.query(`
            UPDATE reservas SET status_cofre = 'liberado' WHERE id_reserva = $1
        `, [reservaId]);

        // Registra transação
        await db.query(`
            INSERT INTO transacoes_pagamento (reserva_id, valor, status, origem)
            VALUES ($1, $2, 'completo', 'cofre')
        `, [reservaId, reserva.valor_pago]);

        return { message: "Cofre liberado e repasse realizado com sucesso." };

    } catch (error) {
        console.error("Erro ao liberar Cofre:", error);
        throw error;
    }
}

module.exports = { liberarCofre };
