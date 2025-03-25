// src/routes/owner/authEmpresaRoutes.js
const express = require('express');
const router = express.Router();
const pool = require('../../config/db');
const jwt = require('jsonwebtoken');

// [POST] Login de Dono de Quadra
router.post('/login', async (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ message: 'Email e senha são obrigatórios.' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM empresas WHERE email_empresa = $1 AND senha = $2',
      [email, senha]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Usuário não encontrado.' });
    }

    const empresa = result.rows[0];
    const token = jwt.sign(
      { id: empresa.id_empresa, role: 'gestor' },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    return res.json({
      token,
      user: {
        id_usuario: empresa.id_empresa,
        nome: empresa.nome,
        email: empresa.email_empresa,
        papel_usuario: 'gestor',
      }
    });
  } catch (error) {
    console.error('[authEmpresa] Erro ao fazer login:', error);
    return res.status(500).json({ message: 'Erro ao fazer login.' });
  }
});

module.exports = router;
