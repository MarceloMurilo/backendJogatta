// passport.js

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const pool = require('./db'); // Ajuste o caminho para seu db
require('dotenv').config();

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL, // com /api/auth
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
          // Cria novo usuário
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
        console.error('Erro na autenticação com Google:', error);
        return done(error, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

module.exports = passport;
