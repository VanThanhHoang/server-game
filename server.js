// server.js - ĐÃ SỬA LỖI VÀ ĐẦY ĐỦ NHẤT

const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();
const server = http.createServer(app);

// Khởi tạo Socket.IO với CORS
const io = socketIO(server, {
  cors: {
    origin: "*", // Cho phép mọi domain kết nối
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// Giả định bạn có một thư mục 'public' chứa controller.html (hoặc chỉ cần để controller.html trong thư mục gốc)
// Nếu bạn muốn truy cập controller.html từ trình duyệt: http://localhost:8182/controller.html
app.use(express.static(path.join(__dirname, "public"))); 

// Store game rooms and their states
const gameRooms = new Map();

// Game states
const GAME_STATES = {
  PENDING: "pending",
  SAVED_SETTINGS: "savedSettings",
  INIT: "init",
  PREPARE: "prepare",
  PLAYING: "playing",
  COMPLETING: "completing",
  COMPLETED: "completed",
};

// Game actions
const ACTIONS = {
  INIT_GAME: "initGame",
  RUN_GAME: "runGame",
  RESET_GAME: "resetGame",
  SHOW_TOP_WINNERS: "showTopWinners",
  SHOW_RESULT_LIST: "showResultList",
  PING_CONTROLLER: "pingController",
  PING_GAME_VIEW: "pingGameView",
  ADDED_CHARACTER: "addedCharacter",
  CHANGE_GAME_STAGE: "changeGameStage",
  REPORT_RESULT: "reportResult",
  GET_ACTION: "gameViewGetAction",
  NOT_ENOUGH_MONEY: "notEnoughMoney",
};

// Initialize or get a game room
function initializeRoom(roomId) {
  if (!gameRooms.has(roomId)) {
    gameRooms.set(roomId, {
      id: roomId,
      state: GAME_STATES.PENDING,
      config: {
        theme: "unicorn", // Default theme
        keyword: "hanagold",
        mode: "random",
        timer: "00:00:30",
        winnersCount: 3,
        maxCharacters: 50,
        scoresForLike: 1,
        scoresForComment: 5,
        scoresForCent: 20,
        volume: 50,
        enableSound: true,
        createdAt: Date.now(),
      },
      characters: [],
      comments: [],
      reactions: [],
      connectedClients: new Set(),
    });
  }
  return gameRooms.get(roomId);
}

// ============== REST API ENDPOINTS ==============

// Trang chủ hiển thị Control Panel (giả định file controller.html nằm trong thư mục public)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "controller.html"));
});

// ✅ 1. API GET ROOM CONFIG
app.post("/api/room/config", (req, res) => {
  const { room } = req.body;
  if (!room) return res.json({ status: "ERROR" });
  const roomData = initializeRoom(room);

  res.json({ status: "GET_SUCCESS" }); // Trả lại status cho client

  // Gửi config qua WebSocket (Game View cần nhận cái này)
  setTimeout(() => {
    io.to(room).emit("room.config", {
      key: "hGame",
      config: roomData.config,
    });
    console.log(`[CONFIG] Sent config to room ${room} via WebSocket`);
  }, 100);
});

// ✅ 2. API UPDATE CONFIG
app.post("/api/room/update-config", (req, res) => {
  const { room, config } = req.body;
  if (!room || !config) return res.json({ status: "ERROR" });
  const roomData = initializeRoom(room);
  
  roomData.config = {
    ...roomData.config,
    ...config,
    createdAt: Date.now(), // Cập nhật timestamp để Game View load lại
  };

  // Gửi config mới ngay lập tức qua WebSocket
  io.to(room).emit("room.config", {
    key: "hGame",
    config: roomData.config,
  });

  console.log(`[CONFIG UPDATE] Room ${room}:`, config);

  res.json({ status: "SUCCESS" });
});

// ✅ 3. API LOAD COMMENT (Game View sử dụng API này để gửi PING/REPORT)
app.post("/api/load-comment/ducky", (req, res) => {
  const { room, config } = req.body;
  if (!room || !config) return res.json({ status: "ERROR" });
  const roomData = initializeRoom(room);
  const { action, data } = config;

  // Cần xử lý các action Game View gửi lên server để lưu lại trạng thái
  switch (action) {
    case ACTIONS.PING_CONTROLLER:
        // Cập nhật trạng thái game từ Game View
        roomData.state = data?.state || roomData.state;
        // Có thể phát lại ping đến Control Panel nếu Control Panel lắng nghe trên kênh onDucky
        io.to(room).emit('onDucky', { action: ACTIONS.PING_CONTROLLER, data: data });
        break;

    case ACTIONS.CHANGE_GAME_STAGE:
        roomData.state = data;
        break;
        
    case ACTIONS.REPORT_RESULT:
        // Lưu kết quả game
        break;
  }

  res.json({ status: "SUCCESS" });
});

// ✅ 4. API TEST ADD COMMENT
app.post("/api/test/add-comment", (req, res) => {
  const { room, comment: clientComment } = req.body;
  if (!room || !clientComment) return res.json({ status: "ERROR" });
  const roomData = initializeRoom(room);
  
  const comment = { 
    id: `c_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    author: {
        id: clientComment.author.id || `test_${Date.now()}`,
        name: clientComment.author.name || 'Test Player',
        avatar: clientComment.author.avatar || `https://ui-avatars.com/api/?name=${clientComment.author.name}`,
    },
    platform: clientComment.platform || { name: 'facebook' },
    text: clientComment.text || '',
    timestamp: Date.now(),
    metadata: clientComment.metadata || {},
  };
  roomData.comments.push(comment);
  
  // Gửi comment đến tất cả client (Game View cần cái này)
  io.to(room).emit("comment", [comment]);
  console.log(`[COMMENT] Added to room ${room}: ${comment.author.name}`);
  res.json({ status: "SUCCESS", comment });
});

// ✅ 5. API TEST ADD REACTION
app.post("/api/test/add-reaction", (req, res) => {
  const { room, author, reaction, metadata } = req.body;
  if (!room || !author || !reaction) return res.json({ status: "ERROR" });
  
  const reactionData = {
    author: { id: author.id }, // Chỉ cần ID để Game View tìm player
    reaction: reaction,
    metadata: metadata || {},
    timestamp: Date.now(),
  };

  // Gửi reaction đến tất cả client (Game View cần cái này)
  io.to(room).emit("reaction", [reactionData]);
  console.log(`[REACTION] Sent ${reaction} for ${author.id} in room ${room}`);
  res.json({ status: "SUCCESS", reaction: reactionData });
});

// ✅ 6. API RESET ROOM (Để Control Panel gọi)
app.post("/api/room/:room/reset", (req, res) => {
  const { room } = req.params;
  gameRooms.delete(room);
  initializeRoom(room);
  console.log(`[RESET] Room ${room} reset`);
  res.json({ status: "SUCCESS", message: "Room reset" });
});

// ✅ Mock Payment
app.get("/api/transaction/checkoutFeature", (req, res) => {
  res.json({ status: true, message: "Payment successful (mock)" });
});

// ✅ Mock Report
app.get("/api/report/reportFeature", (req, res) => {
  res.json({ status: "SUCCESS" });
});


// ============== SOCKET.IO CORE LOGIC ==============

io.on("connection", (socket) => {
  console.log("✅ Client connected:", socket.id);

  socket.on("call", (endpoint, data, callback) => {
    if (endpoint === "live.subscribe") {
      const roomId = data.id;
      socket.join(roomId);
      const roomData = initializeRoom(roomId);
      roomData.connectedClients.add(socket.id);
      
      // Gửi config khi client join
      setTimeout(() => {
        socket.emit("room.config", {
          key: "hGame",
          config: roomData.config,
        });
      }, 100);

      if (callback) callback(null);
    }

    if (endpoint === "load-comment.ducky") {
      const { room, config } = data;
      const { action, data: actionData } = config;

      // 🛑 FIX QUAN TRỌNG NHẤT:
      // Phát lại lệnh điều khiển (INIT_GAME, RUN_GAME,...) 
      // đến TẤT CẢ client trong phòng (io.to(room).emit)
      // để Game View nhận được.
      if ([
        ACTIONS.INIT_GAME, 
        ACTIONS.RUN_GAME, 
        ACTIONS.RESET_GAME, 
        ACTIONS.SHOW_TOP_WINNERS, 
        ACTIONS.SHOW_RESULT_LIST,
        ACTIONS.PING_GAME_VIEW // Gửi ping đến Game View
      ].includes(action)) {
          
          io.to(room).emit("onDucky", {
            action: action,
            data: actionData,
          });
          console.log(`[CONTROL] 📡 Broadcasted action: ${action} to room ${room}`);
      } else {
          // Các action khác (như GET_ACTION từ Game View) chỉ cần gửi đến các client khác
          socket.to(room).emit("onDucky", {
              action: action,
              data: actionData,
          });
      }

      if (callback) callback(null);
    }
  });

  socket.on("disconnect", () => {
    gameRooms.forEach((room) => {
      room.connectedClients.delete(socket.id);
    });
  });
});

// ============== START SERVER ==============

const PORT = process.env.PORT || 8182;

server.listen(PORT, () => {
  console.log("=".repeat(50));
  console.log(`🎮 Duck Racing Game Server - FINAL`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log("=".repeat(50));
});