const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
require('dotenv').config();

const router = express.Router();

// Configuração do Passport com Google OAuth
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Verifica se o usuário já existe no banco
        const userCheck = await pool.query(
          'SELECT * FROM public.usuario WHERE email = $1',
          [profile.emails[0].value]
        );

        let user;
        if (userCheck.rows.length > 0) {
          user = userCheck.rows[0];
        } else {
          // Se o usuário não existir, cria um novo
          const newUser = await pool.query(
            'INSERT INTO public.usuario (nome, email, papel_usuario) VALUES ($1, $2, $3) RETURNING *',
            [profile.displayName, profile.emails[0].value, 'jogador']
          );
          user = newUser.rows[0];
        }

        // Gera token JWT para autenticação
        const token = jwt.sign(
          { id: user.id_usuario, papel_usuario: user.papel_usuario },
          process.env.JWT_SECRET,
          { expiresIn: '1h' }
        );

        return done(null, { token, user });
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

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

    // Log para depuração
    console.log('Token decodificado com sucesso:', decoded);

    req.user = { id: decoded.id, papel_usuario: decoded.papel_usuario };
    next();
  });
};

// Rota para registrar um novo usuário com senha criptografada (Register)
router.post('/register', async (req, res) => {
  const { nome, email, senha, tt, altura, imagem_perfil = null, user_papel_usuario = 'jogador' } = req.body;

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
      [nome, email, hashedPassword, tt, altura, imagem_perfil, user_papel_usuario]
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

    // Gera token JWT (sem incluir imagem_perfil)
    const token = jwt.sign(
      {
        id: usuario.id_usuario,
        nome: usuario.nome,
        email: usuario.email,
        tt: usuario.tt,
        papel_usuario: usuario.papel_usuario,
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Remover a senha antes de enviar os dados do usuário
    const { senha: _, ...usuarioSemSenha } = usuario;

    // Retorna o token e os dados do usuário (sem a senha)
    res.status(200).json({ message: 'Login bem-sucedido!', token, user: usuarioSemSenha });
  } catch (error) {
    console.error('Erro ao realizar login:', error);
    res.status(500).json({ message: 'Erro interno ao realizar login.', error: error.message });
  }
});

// Rota de login com Google
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Callback do Google OAuth
router.get(
  '/google/callback',
  passport.authenticate('google', { session: false }),
  (req, res) => {
    // Redireciona para o frontend com o token gerado
    res.redirect(`http://localhost:3000/auth/success?token=${req.user.token}`);
  }
);

// Rota protegida para autenticação
router.get('/protected', verifyToken, (req, res) => {
  res.status(200).json({
    message: 'Acesso permitido. Você está autenticado!',
    userId: req.user.id,
    papel_usuario: req.user.papel_usuario,
  });
});

module.exports = router;
