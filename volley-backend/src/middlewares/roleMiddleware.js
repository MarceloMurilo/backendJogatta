// roleMiddleware.js
const roleMiddleware = (allowedRoles) => {
  return (req, res, next) => {
    const userRole = req.user.papel_usuario;

    console.log('Papel do usuário:', userRole);
    console.log('Papéis permitidos:', allowedRoles);

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ message: 'Acesso negado - Papel do usuário não autorizado.' });
    }

    next();
  };
};

module.exports = roleMiddleware;
