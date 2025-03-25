// src/middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  console.log('[authMiddleware] Headers recebidos:', req.headers);
  
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('[authMiddleware] Token não fornecido ou formato inválido.');
    return res.status(401).json({ message: 'Token não fornecido ou formato inválido.' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    console.error('[authMiddleware] Token ausente.');
    return res.status(401).json({ message: 'Token não fornecido.' });
  }

  console.log('[authMiddleware] Token recebido:', token);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('[authMiddleware] Token decodificado:', decoded);

    // Verifica se os campos obrigatórios estão presentes
    if (!decoded.id || !decoded.papel_usuario || !decoded.email) {
      console.error('[authMiddleware] Campos obrigatórios ausentes no token:', decoded);
      return res.status(403).json({ message: 'Campos obrigatórios ausentes no token.' });
    }

    // Adiciona os dados do token ao objeto req.user
    req.user = {
      id: decoded.id,
      nome: decoded.nome,
      email: decoded.email,
      tt: decoded.tt,
      papel_usuario: decoded.papel_usuario
    };

    console.log(
      `[authMiddleware] Usuário autenticado: ID ${decoded.id}, Nome ${decoded.nome}, Email ${decoded.email}, Papel ${decoded.papel_usuario}`
    );
    next();
  } catch (err) {
    console.error('[authMiddleware] Erro ao verificar token:', err.message);
    return res.status(401).json({ message: 'Token inválido' });
  }
};

module.exports = authMiddleware;
