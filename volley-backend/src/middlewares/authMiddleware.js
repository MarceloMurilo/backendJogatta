// /middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    console.error(`[authMiddleware] Token de autorização não fornecido.`);
    return res.status(401).json({ message: 'Token não fornecido' });
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      console.error(`[authMiddleware] Erro ao verificar token:`, err.message);
      return res.status(401).json({ message: 'Token inválido' });
    }

    console.log('[authMiddleware] Token decodificado:', decoded);

    if (!decoded.id || !decoded.papel_usuario) {
      console.error('[authMiddleware] Campos obrigatórios ausentes no token.');
      return res
        .status(403)
        .json({ message: 'Campos obrigatórios ausentes no token.' });
    }

    req.user = { id: decoded.id, papel_usuario: decoded.papel_usuario };
    console.log(
      `[authMiddleware] Usuário autenticado: ID ${decoded.id}, Papel ${decoded.papel_usuario}`
    );
    next();
  });
};

module.exports = authMiddleware;
