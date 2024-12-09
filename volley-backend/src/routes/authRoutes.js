const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const router = express.Router();

// Middleware para verificar o token JWT
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('Token não fornecido ou formato inválido.');
    return res.status(403).json({ error: 'Token não fornecido ou formato inválido' });
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      console.error('Token inválido:', err.message);
      return res.status(401).json({ error: 'Token inválido' });
    }

    // Log detalhado para depuração
    console.log('Token decodificado com sucesso:', decoded);

    // Passa o ID e o papel_usuario do usuário para a requisição
    req.user = { id: decoded.id, papel_usuario: decoded.papel_usuario };
    next();
  });
};


// Rota para registrar um novo usuário com senha criptografada (Register)
router.post('/register', async (req, res) => {
  const { nome, email, senha, tt, altura, profile_image = null, user_papel_usuario = 'jogador' } = req.body;

  try {
    // Verificar se o email já está registrado
    const userCheck = await pool.query('SELECT * FROM public.usuario WHERE email = $1', [email]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Email já registrado' });
    }

    // Verificar se o tt já está registrado
    if (tt) {
      const ttCheck = await pool.query('SELECT * FROM public.usuario WHERE tt = $1', [tt]);
      if (ttCheck.rows.length > 0) {
        return res.status(400).json({ error: 'TT já registrado' });
      }
    }

    // Criptografar a senha
    const hashedPassword = await bcrypt.hash(senha, 10);

     // Inserir o novo usuário no banco de dados
     const result = await pool.query(
      'INSERT INTO public.usuario (nome, email, senha, tt, altura, imagem_perfil, papel_usuario) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [nome, email, hashedPassword, tt, altura, profile_image, user_papel_usuario]
    );
    
    // Gerar o token JWT com `id` e `papel_usuario`
    const token = jwt.sign(
      { id: result.rows[0].id_usuario, papel_usuario: result.rows[0].papel_usuario },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Retornar o token e os dados do usuário (sem a senha)
    res.status(201).json({ token, user: { ...result.rows[0], senha: undefined } });
  } catch (error) {
    console.error('Erro ao registrar o usuário:', error);
    res.status(500).json({ error: 'Erro ao registrar o usuário' });
  }
});



// Rota de login
router.post('/login', async (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ message: 'Email/TT e senha são obrigatórios.' });
  }

  try {
    // Verifica se o valor enviado é um email (contém @) ou um TT
    const query = email.includes('@')
      ? 'SELECT * FROM public.usuario WHERE email = $1'
      : 'SELECT * FROM public.usuario WHERE tt = $1';

    const result = await pool.query(query, [email]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }

    const usuario = result.rows[0];

    // Verifica a senha
    const senhaValida = await bcrypt.compare(senha, usuario.senha);
    if (!senhaValida) {
      return res.status(401).json({ message: 'Senha inválida.' });
    }

    // Gera token JWT
    const token = jwt.sign(
      {
        id: usuario.id_usuario,
        nome: usuario.nome,
        email: usuario.email,
        tt: usuario.tt, // Inclui o TT no payload do token
        papel_usuario: usuario.papel_usuario, // Inclui o papel do usuário
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Retorna o token
    res.status(200).json({ message: 'Login bem-sucedido!', token });
  } catch (error) {
    console.error('Erro ao realizar login:', error);
    res.status(500).json({ message: 'Erro interno ao realizar login.', error: error.message });
  }
});



// Rota protegida para autenticação
router.get('/protected', verifyToken, (req, res) => {
  res.status(200).json({
    message: 'Acesso permitido. Você está autenticado!',
    userId: req.user.id, // Garantir que o ID do usuário está vindo do middleware
    papel_usuario: req.user.papel_usuario, // Papel do usuário
  });
});

module.exports = router;
