// src/routes/pdfRoutes.js
const express = require('express');
const router = express.Router();

/**
 * Rota para logar status de geração de PDF
 * Exemplo de corpo esperado (POST):
 * {
 *   status: 'iniciando' | 'sucesso' | 'erro',
 *   info: 'mensagem adicional'
 * }
 */
router.post('/logStatus', (req, res) => {
  const { status, info } = req.body;
  // Aqui você pode salvar no DB ou apenas imprimir no console
  console.log('=== LOG DE PDF ===');
  console.log('Status:', status);
  console.log('Info:', info);
  console.log('==================');

  return res.json({
    message: 'Log de PDF recebido com sucesso',
    received: { status, info },
  });
});

module.exports = router;
