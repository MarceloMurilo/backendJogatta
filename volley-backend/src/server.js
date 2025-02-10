// server.js

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const db = require('./db');
const fs = require('fs');
const path = require('path');
const passport = require('passport'); // Importação do Passport

const app = express();

// Middlewares
const authMiddleware = require('./middlewares/authMiddleware');
const roleMiddleware = require('./middlewares/roleMiddleware');

// Importar todas as rotas
const jogadorRoutes = require('./routes/jogador/jogadorRoutes');
const reservationRoutes = require('./routes/jogador/reservationRoutes');
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
const chatRoutes = require('./routes/chatRoutes');
const balanceamentoRoutes = require('./routes/jogador/balanceamentoRoutes');
const temporariosRoutes = require('./routes/jogador/temporariosRoutes');

// === Importação nova do arquivo de rotas para PDF ===
const pdfRoutes = require('./routes/pdfRoutes');

// Caminho para o diretório `pdf`
const pdfDir = path.join(__dirname, 'pdf');

// Criar o diretório, caso não exista
if (!fs.existsSync(pdfDir)) {
  fs.mkdirSync(pdfDir, { recursive: true });
  console.log('Diretório "pdf" criado automaticamente.');
}

// Configurações globais
app.use(express.json());
app.use(cors());
app.use(passport.initialize()); // Inicialização do Passport

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
//          ROTAS
// ===================================

// Rotas para jogador
app.use(
  '/api/jogador',
  authMiddleware,
  roleMiddleware(['jogador', 'organizador']),
  jogadorRoutes
);
app.use('/api/jogador/reservas', authMiddleware, reservationRoutes);
app.use('/api/jogos', authMiddleware, jogosRoutes);

// Rotas para owner
app.use(
  '/api/owner/quadras',
  authMiddleware,
  roleMiddleware(['owner']),
  courtManagementRoutes
);
app.use('/api/owner/reservas', authMiddleware, ownerReservationsRoutes);

// Rotas de autenticação e usuário
app.use('/api/auth', authRoutes);
app.use('/api/usuario', userRoutes);

// Rotas para empresa
app.use('/api/empresas', authMiddleware, companyRoutes);

// Rotas de convites
app.use('/api/convites', authMiddleware, convitesRoutes);
app.use('/api/convites/usuario', authMiddleware, convitesUserRoutes);

// Rotas de avaliações
app.use('/api/avaliacoes', authMiddleware, avaliacoesRoutes);

// Rotas de amigos
app.use('/api/amigos', authMiddleware, amigosRoutes);

// Rotas de grupos
app.use('/api/groups', groupRoutes);

// Rotas de lobby
app.use('/api/lobby', authMiddleware, lobbyRoutes);

// Rotas de CEP
app.use('/api/cep', authMiddleware, cepRoutes);

// Rotas de balanceamento
app.use('/api/balanceamento', balanceamentoRoutes);

// Rotas de chat
app.use('/api/chat', authMiddleware, chatRoutes);

// Rotas de temporários
app.use('/api/temporarios', temporariosRoutes);

// === Aqui usamos a nova rota de PDF ===
app.use('/api/pdf', pdfRoutes);

// Rota de teste
app.get('/api/test', (req, res) => {
  res.json({ message: 'Rota de teste funcionando!' });
});

// Cron job para encerrar jogos automaticamente
cron.schedule('*/5 * * * *', async () => {
  console.log('Verificando jogos que precisam ser encerrados...');
  try {
    await db.query(`
      UPDATE jogos
         SET status = 'encerrada'
       WHERE horario_fim < NOW()
         AND status = 'ativa'
    `);
    console.log('Jogos encerrados automaticamente, se aplicável.');
  } catch (error) {
    console.error('Erro ao encerrar jogos automaticamente:', error);
  }
});

// Exibir rotas registradas
app._router.stack.forEach(function (r) {
  if (r.route && r.route.path) {
    const methods = Object.keys(r.route.methods)
      .map(method => method.toUpperCase())
      .join(', ');
    console.log(`Rota registrada: ${r.route.path} [${methods}]`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
