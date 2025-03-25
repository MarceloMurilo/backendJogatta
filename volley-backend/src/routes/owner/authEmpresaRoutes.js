const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../config/db');
const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, senha } = req.body;

  try {
    const result = await pool.query(
      'SELECT * FROM empresas WHERE email_empresa = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }

    const empresa = result.rows[0];

    const senhaCorreta = await bcrypt.compare(senha, empresa.senha);

    if (!senhaCorreta) {
      return res.status(401).json({ message: 'Senha incorreta.' });
    }

    const token = jwt.sign(
      { id: empresa.id_empresa, papel_usuario: 'gestor' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: {
        id_usuario: empresa.id_empresa,
        nome: empresa.nome,
        email: empresa.email_empresa,
        papel_usuario: 'gestor',
        imagem_perfil: null, // ou empresa.logo se tiver
        tt: null,
        descricao: empresa.descricao || ''
      }
    });

  } catch (error) {
    console.error('Erro ao fazer login do dono de quadra:', error);
    return res.status(500).json({ message: 'Erro interno no servidor.' });
  }
});

module.exports = router;
