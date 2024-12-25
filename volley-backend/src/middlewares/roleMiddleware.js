const db = require('../db');

const roleMiddleware = (allowedRoles) => {
  return async (req, res, next) => {
    const { id } = req.user; // ID do usuário autenticado
    const { id_jogo } = req.body; // ID do jogo fornecido na requisição

    // Verificar se o id_jogo foi fornecido
    if (!id_jogo) {
      return res.status(400).json({ message: 'ID do jogo é obrigatório.' });
    }

    console.log(`[roleMiddleware] Verificando papel do usuário (ID: ${id}) no jogo (ID: ${id_jogo})`);

    try {
      const query = `
        SELECT uf.id_funcao, f.nome_funcao 
        FROM usuario_funcao uf
        JOIN funcao f ON uf.id_funcao = f.id_funcao
        WHERE uf.id_usuario = $1 AND uf.id_jogo = $2 AND uf.expira_em > NOW()
      `;
      const result = await db.query(query, [id, id_jogo]);

      if (result.rowCount === 0) {
        console.log(`[roleMiddleware] Usuário não possui função válida no jogo ${id_jogo}`);
        return res.status(403).json({ message: 'Acesso negado - Você não tem permissão para este jogo.' });
      }

      const userRole = result.rows[0].nome_funcao;

      if (!allowedRoles.includes(userRole)) {
        console.log(`[roleMiddleware] Função ${userRole} não autorizada para este endpoint.`);
        return res.status(403).json({ message: 'Acesso negado - Papel do usuário não autorizado neste jogo.' });
      }

      console.log(`[roleMiddleware] Permissão concedida para o papel ${userRole}`);
      next(); // Permissão validada, prossegue
    } catch (error) {
      console.error(`[roleMiddleware] Erro ao verificar função do usuário:`, error);
      return res.status(500).json({ message: 'Erro interno no servidor ao validar permissões.' });
    }
  };
};

module.exports = roleMiddleware;
