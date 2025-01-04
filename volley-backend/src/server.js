// server.js

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const db = require('./db');

const app = express();

// Middlewares
const authMiddleware = require('./middlewares/authMiddleware');
const roleMiddleware = require('./middlewares/roleMiddleware'); // se precisar em outras rotas

// Rotas
const jogadorRoutes = require('./routes/jogador/jogadorRoutes');
const reservationRoutes = require('./routes/jogador/reservationRoutes');
// const gameRoutes = require('./routes/jogador/jogosRoutes');
const jogosRoutes = require('./routes/jogador/jogosRoutes');
const courtManagementRoutes = require('./routes/owner/courtManagementRoutes');
const ownerReservationsRoutes = require('./routes/owner/ownerReservationsRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const companyRoutes = require('./routes/companyRoutes');
const convitesRoutes = require('./routes/invites/inviteRoutes');
const convitesUserRoutes = require('./routes/invites/inviteUserRoutes');
const cepRoutes = require('./routes/cepRoutes/cepRoutes');
const groupRoutes = require('./routes/groupRoutes');
const amigosRoutes = require('./routes/amigosRoutes');
const avaliacoesRoutes = require('./routes/jogador/AvaliacoesRoutes');
const lobbyRoutes = require('./routes/invites/lobbyRoutes');

// === Adicione a importação das rotas de balanceamento ===
const balanceamentoRoutes = require('./routes/jogador/balanceamentoRoutes');

// Configurações globais
app.use(express.json());
app.use(cors());

// Middleware de logging
app.use((req, res, next) => {
  console.log(`\n=== Nova requisição recebida ===`);
  console.log(`Método: ${req.method}`);
  console.log(`URL: ${req.url}`);
  console.log(`Body:`, req.body);
  console.log('==============================\n');
  next();
});

// ===================================
//  ROTAS
// ===================================

// (Exemplo) Rotas para jogador (estas ainda usam roleMiddleware se quiser)
app.use('/api/jogador', authMiddleware, roleMiddleware(['jogador', 'organizador']), jogadorRoutes);
app.use('/api/jogador/reservas', authMiddleware, reservationRoutes);
// app.use('/api/jogador/times', authMiddleware, gameRoutes);
app.use('/api/jogos', authMiddleware, jogosRoutes);

// (Exemplo) Rotas para owner
app.use('/api/owner/quadras', authMiddleware, roleMiddleware(['owner']), courtManagementRoutes);
app.use('/api/owner/reservas', authMiddleware, ownerReservationsRoutes);

// (Exemplo) Rotas de auth
app.use('/api/auth', authRoutes);
app.use('/api/usuario', userRoutes);

// (Exemplo) Rotas para empresa
app.use('/api/empresas', authMiddleware, companyRoutes);

// (Exemplo) Rotas de convites
app.use('/api/convites', authMiddleware, convitesRoutes);
app.use('/api/convites/usuario', authMiddleware, convitesUserRoutes);

// (Exemplo) Rotas de avaliações
app.use('/api/avaliacoes', authMiddleware, avaliacoesRoutes);

// (Exemplo) Rotas de amigos
app.use('/api/amigos', authMiddleware, amigosRoutes);

// (Exemplo) Rotas de grupos
app.use('/api/groups', groupRoutes);

// (Exemplo) Rotas de lobby
app.use('/api/lobby', authMiddleware, lobbyRoutes);

// (Exemplo) Rotas de CEP
app.use('/api/cep', authMiddleware, cepRoutes);

// === Aqui definimos as ROTAS DE BALANCEAMENTO, sem roleMiddleware no server ===
app.use('/api/balanceamento', balanceamentoRoutes);

// Rota de teste
app.get('/api/test', (req, res) => {
  res.json({ message: 'Rota de teste funcionando!' });
});

// Cron job para encerrar jogos automaticamente
cron.schedule('*/5 * * * *', async () => {
  console.log('Verificando jogos que precisam ser encerrados...');
  try {
    const agora = new Date();
    const result = await db.query(`
      UPDATE jogos
         SET status = 'encerrada'
       WHERE horario_fim < NOW()
         AND status = 'ativa'
    `);

    if (result.rowCount > 0) {
      console.log(`${result.rowCount} jogos encerrados automaticamente.`);
    }
  } catch (error) {
    console.error('Erro ao encerrar jogos automaticamente:', error);
  }
});

// Exibir rotas registradas
app._router.stack.forEach(function (r) {
  if (r.route && r.route.path) {
    console.log(`Rota registrada: ${r.route.path} [${Object.keys(r.route.methods)}]`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
