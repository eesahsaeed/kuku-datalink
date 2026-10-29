const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

function initSocketServer({ server, app, jwtSecret }) {
  const io = new Server(server, {
    cors: {
      origin: true,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  app.set('io', io);

  io.use((socket, next) => {
    const authorization = socket.handshake.headers.authorization || '';
    const headerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    const token = socket.handshake.auth?.token || headerToken;

    if (!token) {
      return next(new Error('Socket connection requires a bearer token'));
    }

    try {
      const decoded = jwt.verify(token, jwtSecret);
      const userId = String(
        decoded?.id || decoded?._id || decoded?.userId || decoded?.user?.id || decoded?.user?._id || '',
      ).trim();

      if (!userId) {
        return next(new Error('Bearer token does not contain a user ID'));
      }

      const roles = Array.isArray(decoded?.roles)
        ? decoded.roles
        : [decoded?.role].filter(Boolean);

      socket.data.user = {
        ...decoded,
        id: userId,
        emailAddress: decoded?.emailAddress || decoded?.email || '',
        roles: roles.map((role) => String(role).toLowerCase()),
      };

      return next();
    } catch {
      return next(new Error('Invalid socket bearer token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    const userId = user.id;
    const emailAddress = String(user.emailAddress || '').trim().toLowerCase();
    const roles = user.roles;

    socket.join(`user:${userId}`);
    if (emailAddress) socket.join(emailAddress);

    socket.emit("demo", {success: true, message: "Welcome to socket.io"})

    socket.on('disconnect', () => {
      console.log('User disconnected', userId, socket.id);
    });

    if (roles.includes('admin')) {
      // console.log("Admin user connected ", socket.id);
      socket.join("admin-dashboard");
    }

    if (roles.includes('staff')){
      // console.log("Staff user connected ", socket.id)
      socket.join("staff-dashboard")
    }
  });

  // console.log('Socket.IO server initialized');
  return io;
}

module.exports = {
  initSocketServer
};
