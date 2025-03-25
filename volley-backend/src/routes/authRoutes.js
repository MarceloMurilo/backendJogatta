// src/routes/authRoutes.js
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const ownerService = require('../services/ownerService'); // Novo uso para criação da empresa

const router = express.Router();

// ===========================
// CONFIG PASSPORT (GOOGLE)
// ===========================
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // Lê o callbackURL do .env
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Verifica se o usuário já existe
        const userCheck = await pool.query(
          'SELECT * FROM public.usuario WHERE email = $1',
          [profile.emails[0].value]
        );

        let user;
        if (userCheck.rows.length > 0) {
          user = userCheck.rows[0];
        } else {
          // Se não existir, cria novo
          const newUser = await pool.query(
            'INSERT INTO public.usuario (nome, email, papel_usuario) VALUES ($1, $2, $3) RETURNING *',
            [profile.displayName, profile.emails[0].value, 'jogador']
          );
          user = newUser.rows[0];
        }

        // Gera token JWT
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

// Middleware para verificar token
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('Token não fornecido ou formato inválido.');
    return res
      .status(403)
      .json({ error: 'Token não fornecido ou formato inválido' });
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      console.error('Token inválido:', err.message);
      return res.status(401).json({ error: 'Token inválido' });
    }

    console.log('Token decodificado com sucesso:', decoded);

    req.user = { id: decoded.id, papel_usuario: decoded.papel_usuario };
    next();
  });
};

// =============================
//    ROTA DE REGISTER (Jogador)
// =============================
router.post('/register', async (req, res) => {
  const {
    nome,
    email,
    senha,
    tt,
    altura,
    imagem_perfil = null,
    user_papel_usuario = 'jogador',
  } = req.body;

  try {
    // Verificar se o email já está no bd
    const userCheck = await pool.query(
      'SELECT * FROM public.usuario WHERE email = $1',
      [email]
    );
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Email já registrado' });
    }

    // Verificar se o tt já está registrado
    if (tt) {
      const ttCheck = await pool.query(
        'SELECT * FROM public.usuario WHERE tt = $1',
        [tt]
      );
      if (ttCheck.rows.length > 0) {
        return res.status(400).json({ error: 'TT já registrado' });
      }
    }

    // Criptografar senha
    const hashedPassword = await bcrypt.hash(senha, 10);

    // Inserir novo usuário
    const result = await pool.query(
      'INSERT INTO public.usuario (nome, email, senha, tt, altura, imagem_perfil, papel_usuario) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [nome, email, hashedPassword, tt, altura, imagem_perfil, user_papel_usuario]
    );

    // Gerar token
    const token = jwt.sign(
      {
        id: result.rows[0].id_usuario,
        papel_usuario: result.rows[0].papel_usuario,
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res
      .status(201)
      .json({ token, user: { ...result.rows[0], senha: undefined } });
  } catch (error) {
    console.error('Erro ao registrar usuário:', error);
    res.status(500).json({ error: 'Erro ao registrar o usuário' });
  }
});

// =============================
//    NOVO: ROTA DE REGISTER PARA GESTOR
// =============================
router.post('/register-gestor', async (req, res) => {
  const {
    // Dados do usuário
    nome,
    email,
    senha,
    tt,
    altura,
    imagem_perfil = null,
    // Forçamos o papel para gestor
    // Dados da empresa
    empresa_nome,
    cnpj,
    endereco,
    contato,
    email_empresa,
    documento_url = null
  } = req.body;

  try {
    // Verificar se o email do usuário já está registrado
    const userCheck = await pool.query(
      'SELECT * FROM public.usuario WHERE email = $1',
      [email]
    );
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Email já registrado' });
    }

    // Verificar se o TT já está registrado (se fornecido)
    if (tt) {
      const ttCheck = await pool.query(
        'SELECT * FROM public.usuario WHERE tt = $1',
        [tt]
      );
      if (ttCheck.rows.length > 0) {
        return res.status(400).json({ error: 'TT já registrado' });
      }
    }

    // Criptografar senha para o usuário
    const hashedPassword = await bcrypt.hash(senha, 10);

    // Inserir novo usuário com papel 'gestor'
    const userResult = await pool.query(
      'INSERT INTO public.usuario (nome, email, senha, tt, altura, imagem_perfil, papel_usuario) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [nome, email, hashedPassword, tt, altura, imagem_perfil, 'gestor']
    );
    const novoUsuario = userResult.rows[0];

    // Agora cria a empresa e vincula ao usuário usando o ownerService
    // Note que o ownerService.createGestorEmpresa vai esperar o campo "senha" em formato plain-text para gerar o hash (se desejar armazenar a senha na empresa também)
    const novaEmpresa = await ownerService.createGestorEmpresa({
      nome: empresa_nome,
      endereco,        // pode ser o mesmo que localizacao
      contato,
      email_empresa,
      cnpj,
      senha,           // senha em texto plano para criação (o service irá hash)
      documento_url
    }, novoUsuario.id_usuario);

    // Gera token JWT para o usuário recém-criado
    const token = jwt.sign(
      {
        id: novoUsuario.id_usuario,
        papel_usuario: novoUsuario.papel_usuario,
        nome: novoUsuario.nome,
        email: novoUsuario.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.status(201).json({
      message: 'Registro de Gestor realizado com sucesso! A empresa está pendente de aprovação.',
      token,
      user: { ...novoUsuario, senha: undefined },
      empresa: novaEmpresa
    });
  } catch (error) {
    console.error('Erro no registro de gestor:', error);
    res.status(500).json({ error: 'Erro ao registrar gestor.' });
  }
});

// =============================
//       ROTA DE LOGIN
// =============================
router.post('/login', async (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res
      .status(400)
      .json({ message: 'Email/TT e senha são obrigatórios.' });
  }

  try {
    // Verifica se é email ou TT
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

    // Gera token
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

    const { senha: _, ...usuarioSemSenha } = usuario;

    res
      .status(200)
      .json({ message: 'Login bem-sucedido!', token, user: usuarioSemSenha });
  } catch (error) {
    console.error('Erro ao realizar login:', error);
    res
      .status(500)
      .json({ message: 'Erro interno ao realizar login.', error: error.message });
  }
});

// =============================
//   ROTA DE LOGIN COM GOOGLE
// =============================
router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// =============================
//   CALLBACK DO GOOGLE
// =============================
router.get(
  '/google/callback',
  passport.authenticate('google', { session: false }),
  (req, res) => {
    const token = req.user.token;

    // Se está rodando no Expo ou Web, define a URL final:
    const expoRedirectUri =
      process.env.EXPO_REDIRECT_URI || 'exp://192.168.0.10:8081/--/auth/success';
    const webRedirectUri =
      process.env.WEB_REDIRECT_URI ||
      'https://frontendjogatta.onrender.com/auth/success';

    // Se estiver em produção, redireciona para web, senão para expo
    const redirectUri =
      process.env.NODE_ENV === 'production' ? webRedirectUri : expoRedirectUri;

    console.log(`Redirecionando para ${redirectUri}?token=${token}`);
    res.redirect(`${redirectUri}?token=${token}`);
  }
);

// =============================
//   ROTA PROTEGIDA (exemplo)
// =============================
router.get('/protected', verifyToken, (req, res) => {
  res.status(200).json({
    message: 'Acesso permitido. Você está autenticado!',
    userId: req.user.id,
    papel_usuario: req.user.papel_usuario,
  });
});

module.exports = router;
