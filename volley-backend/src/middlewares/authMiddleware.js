// authMiddleware.js
const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    return res.status(403).json({ message: 'Token não fornecido' });
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: 'Token inválido' });
    }

    // Verifique o conteúdo do token decodificado
    console.log('Token decodificado:', decoded);

    // Assegure-se de que 'papel_usuario' está presente no token
    if (!decoded.papel_usuario) {
      return res.status(403).json({ message: 'Papel do usuário não fornecido no token' });
    }

    req.user = { id: decoded.id, papel_usuario: decoded.papel_usuario };
    next();
  });
};

module.exports = authMiddleware;
