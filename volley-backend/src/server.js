// server.js

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const db = require('./db');
const fs = require('fs');
const path = require('path');
const passport = require('passport');

const app = express();

// ===================================
//          ROTAS ESTÁTICAS
// ===================================
app.get('/', (req, res) => {
  res.status(200).send('Backend do Jogatta está online! 🚀');
});

app.get('/politica-privacidade', (req, res) => {
  res.send(`
    <h1>Política de Privacidade</h1>
    <p>Conteúdo da política de privacidade do Jogatta...</p>
  `);
});

app.get('/termos-servico', (req, res) => {
  res.send(`
    <h1>Termos de Serviço</h1>
    <p>Conteúdo dos termos de serviço do Jogatta...</p>
  `);
});

// ===================================
//          MIDDLEWARES GLOBAIS
// ===================================
app.use(express.json());
app.use(cors());
app.use(passport.initialize());

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
//          IMPORTAÇÃO DE ROTAS
// ===================================
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
const pdfRoutes = require('./routes/pdfRoutes');

// ===================================
//          CONFIGURAÇÃO DO PDF
// ===================================
const pdfDir = path.join(__dirname, 'pdf');
if (!fs.existsSync(pdfDir)) {
  fs.mkdirSync(pdfDir, { recursive: true });
  console.log('Diretório "pdf" criado automaticamente.');
}

// ===================================
//          REGISTRO DE ROTAS
// ===================================
// Rotas para jogador
app.use(
  '/api/jogador',
  require('./middlewares/authMiddleware'),
  require('./middlewares/roleMiddleware')(['jogador', 'organizador']),
  jogadorRoutes
);

app.use('/api/jogador/reservas', require('./middlewares/authMiddleware'), reservationRoutes);
app.use('/api/jogos', require('./middlewares/authMiddleware'), jogosRoutes);

// Rotas para owner
app.use(
  '/api/owner/quadras',
  require('./middlewares/authMiddleware'),
  require('./middlewares/roleMiddleware')(['owner']),
  courtManagementRoutes
);

app.use('/api/owner/reservas', require('./middlewares/authMiddleware'), ownerReservationsRoutes);

// Rotas de autenticação
app.use('/api/auth', authRoutes);
app.use('/api/usuario', userRoutes);

// Rotas para empresa
app.use('/api/empresas', require('./middlewares/authMiddleware'), companyRoutes);

// Rotas de convites
app.use('/api/convites', require('./middlewares/authMiddleware'), convitesRoutes);
app.use('/api/convites/usuario', require('./middlewares/authMiddleware'), convitesUserRoutes);

// Rotas de avaliações
app.use('/api/avaliacoes', require('./middlewares/authMiddleware'), avaliacoesRoutes);

// Rotas de amigos
app.use('/api/amigos', require('./middlewares/authMiddleware'), amigosRoutes);

// Rotas de grupos
app.use('/api/groups', groupRoutes);

// Rotas de lobby
app.use('/api/lobby', require('./middlewares/authMiddleware'), lobbyRoutes);

// Rotas de CEP
app.use('/api/cep', require('./middlewares/authMiddleware'), cepRoutes);

// Rotas de balanceamento
app.use('/api/balanceamento', balanceamentoRoutes);

// Rotas de chat
app.use('/api/chat', require('./middlewares/authMiddleware'), chatRoutes);

// Rotas temporárias
app.use('/api/temporarios', temporariosRoutes);

// Rotas de PDF
app.use('/api/pdf', pdfRoutes);

// ===================================
//          CONFIGURAÇÕES FINAIS
// ===================================
// Cron job para encerrar jogos
cron.schedule('*/5 * * * *', async () => {
  console.log('Verificando jogos que precisam ser encerrados...');
  try {
    await db.query(`
      UPDATE jogos
         SET status = 'encerrada'
       WHERE horario_fim < NOW()
         AND status = 'ativa'
    `);
    console.log('Jogos encerrados automaticamente.');
  } catch (error) {
    console.error('Erro ao encerrar jogos:', error);
  }
});

// Exibir rotas registradas (para debug)
app._router.stack.forEach((layer) => {
  if (layer.route) {
    const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
    console.log(`[ROTA] ${layer.route.path} (${methods})`);
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
  console.log(`🔗 Acesse: http://localhost:${PORT}`);
});