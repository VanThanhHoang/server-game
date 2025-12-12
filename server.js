// server.js - ĐÃ SỬA LỖI VÀ ĐẦY ĐỦ NHẤT

const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const cors = require("cors");
const path = require("path");
const { commentsService } = require("./src/service.js");


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
      commentConfig: {
        enabled: false,
        apiVersion: 'v19.0',
        liveVideoId: '',
        accessToken: '',
        cookie: '',
        limit: 20,
        filter: 'toplevel',
        liveFilter: 'filter_low_quality',
        order: 'reverse_chronological',
        summaryFields: ['total_count', 'can_comment'],
        fields: 'id,message,from{id,name,picture},created_time',
        pollingInterval: 1000,
      },
      commentPolling: null, // Store polling cleanup function
      seenCommentIds: new Set(),
      addedPlayerIds: new Set(), // Track unique players to prevent duplicates
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

  // Change state to SAVED_SETTINGS when config is saved
  roomData.state = GAME_STATES.SAVED_SETTINGS;
  console.log(`[CONFIG] State changed to SAVED_SETTINGS for room ${room}`);

  // Gửi config mới ngay lập tức qua WebSocket
  io.to(room).emit("room.config", {
    key: "hGame",
    config: roomData.config,
  });

  // Broadcast state change
  io.to(room).emit('game_state_changed', { state: GAME_STATES.SAVED_SETTINGS });

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
      // Clear added players when resetting or initializing
      if (data === GAME_STATES.INIT || data === GAME_STATES.PENDING) {
        roomData.addedPlayerIds.clear();
        console.log(`[STATE] Cleared player tracking for state: ${data}`);
      }
      // Broadcast state change to all clients
      io.to(room).emit('game_state_changed', { state: data });
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
  const roomData = initializeRoom(room);
  // Broadcast reset to all clients
  io.to(room).emit('game_state_changed', { state: roomData.state });
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

// ✅ 7. API UPDATE COMMENT CONFIG (without auto-start)
app.post("/api/room/update-comment-config", (req, res) => {
  const { room, config } = req.body;
  if (!room || !config) return res.json({ status: "ERROR", message: "Missing room or config" });

  const roomData = initializeRoom(room);

  // Update config (but don't start polling automatically)
  roomData.commentConfig = {
    ...roomData.commentConfig,
    ...config,
  };

  console.log(`[COMMENT CONFIG] Updated for room ${room}:`, config);
  res.json({ status: "SUCCESS", config: roomData.commentConfig });
});

// ✅ 8. API START COMMENT POLLING
app.post("/api/room/start-comment-polling", (req, res) => {
  const { room } = req.body;
  if (!room) return res.json({ status: "ERROR", message: "Missing room" });

  const roomData = initializeRoom(room);

  // Check if required fields are present
  if (!roomData.commentConfig.liveVideoId || !roomData.commentConfig.accessToken) {
    return res.json({
      status: "ERROR",
      message: "Missing liveVideoId or accessToken. Please save config first."
    });
  }

  // Stop existing polling if any
  if (roomData.commentPolling) {
    roomData.commentPolling();
    roomData.commentPolling = null;
  }

  // Start polling
  startCommentPolling(room);

  console.log(`[COMMENT POLLING] Started for room ${room}`);
  res.json({ status: "SUCCESS", message: "Comment polling started" });
});

// ✅ 9. API STOP COMMENT POLLING
app.post("/api/room/stop-comment-polling", (req, res) => {
  const { room } = req.body;
  if (!room) return res.json({ status: "ERROR", message: "Missing room" });

  const roomData = gameRooms.get(room);
  if (!roomData) {
    return res.json({ status: "ERROR", message: "Room not found" });
  }

  // Stop polling if running
  if (roomData.commentPolling) {
    roomData.commentPolling();
    roomData.commentPolling = null;
    console.log(`[COMMENT POLLING] Stopped for room ${room}`);
    res.json({ status: "SUCCESS", message: "Comment polling stopped" });
  } else {
    res.json({ status: "SUCCESS", message: "Comment polling was not running" });
  }
});

// ✅ 10. API GET COMMENT CONFIG
app.get("/api/room/:room/comment-config", (req, res) => {
  const { room } = req.params;
  const roomData = initializeRoom(room);
  res.json({ status: "SUCCESS", config: roomData.commentConfig });
});

// ✅ 11. ROUTE /showcmt - Display comments
app.get("/showcmt", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "showcmt.html"));
});

// Function to start comment polling for a room
function startCommentPolling(roomId) {
  const roomData = gameRooms.get(roomId);
  if (!roomData) return;

  const config = roomData.commentConfig;

  console.log(`[COMMENT POLLING] Starting for room ${roomId}, video: ${config.liveVideoId}`);

  commentsService.pollComments(
    config,
    config.pollingInterval || 1000,
    (comments) => {
      // Filter only new comments
      const newComments = comments.filter(comment => {
        if (roomData.seenCommentIds.has(comment.id)) {
          return false;
        }
        roomData.seenCommentIds.add(comment.id);
        return true;
      });

      if (newComments.length > 0) {
        console.log(`[COMMENT] ${newComments.length} new comment(s) in room ${roomId}`);

        // Transform comments
        const transformedComments = newComments.map(comment => ({
          id: comment.id,
          author: {
            id: comment.from?.id || 'unknown',
            name: comment.from?.name || 'Unknown',
            avatar: comment.from?.picture?.data?.url || '',
          },
          platform: { name: 'facebook' },
          text: comment.message || '',
          timestamp: new Date(comment.created_time).getTime(),
          metadata: { created_time: comment.created_time },
        }));

        // Mark player comments based on game state
        console.log(`[FILTER] Current game state: ${roomData.state}`);

        // If game is in INIT state, mark comments that should add players
        if (roomData.state === GAME_STATES.INIT) {
          const keyword = roomData.config.keyword?.toLowerCase() || '';
          console.log(`[FILTER] INIT mode active, marking player comments by keyword: "${keyword}"`);

          transformedComments.forEach(comment => {
            const commentText = comment.text.toLowerCase();
            const authorId = comment.author.id;

            // Check if comment contains keyword
            const hasKeyword = keyword ? commentText.includes(keyword) : true;

            // Check if player already added
            const isDuplicate = roomData.addedPlayerIds.has(authorId);

            console.log(`[FILTER] Comment from ${comment.author.name}: text="${comment.text}", hasKeyword=${hasKeyword}, isDuplicate=${isDuplicate}`);

            if (hasKeyword && !isDuplicate) {
              // Add player to tracking set
              roomData.addedPlayerIds.add(authorId);
              // Mark this comment as a player comment
              comment.metadata.isPlayerComment = true;
              console.log(`[INIT] ✅ Marked as player comment: ${comment.author.name} (${authorId})`);
            } else if (hasKeyword && isDuplicate) {
              console.log(`[INIT] ❌ Duplicate player: ${comment.author.name} (${authorId})`);
            } else {
              console.log(`[INIT] ℹ️ Regular comment (no keyword): ${comment.author.name}`);
            }
          });
        }

        // Broadcast ALL comments to dashboard/showcmt
        if (transformedComments.length > 0) {
          // Debug: log room and socket info
          const socketRoom = io.sockets.adapter.rooms.get(roomId);
          console.log(`[DEBUG] Broadcasting to room: ${roomId}`);
          console.log(`[DEBUG] Clients in room: ${socketRoom ? socketRoom.size : 0}`);

          // Emit ALL comments to dashboard/showcmt (uses facebook_comment event)
          io.to(roomId).emit("facebook_comment", transformedComments);

          // Emit only player comments to game view (uses comment event)
          const playerComments = transformedComments.filter(c => c.metadata?.isPlayerComment);
          if (playerComments.length > 0) {
            io.to(roomId).emit("comment", playerComments);
            console.log(`[COMMENT] ✅ Sent ${playerComments.length} player comment(s) to game`);
          }

          // Also add to room's comment array
          roomData.comments.push(...transformedComments);

          console.log(`[COMMENT] ✅ Broadcasted ${transformedComments.length} comment(s) to dashboard, ${playerComments.length} to game`);
        }
      }
    },
    (error) => {
      console.error(`[COMMENT ERROR] Room ${roomId}:`, error.message);

      // Broadcast error as a special system comment to dashboard
      const errorComment = {
        id: `error_${Date.now()}`,
        author: {
          id: 'system',
          name: '⚠️ HỆ THỐNG',
          avatar: 'https://ui-avatars.com/api/?name=System&background=ff0000&color=fff',
        },
        platform: { name: 'system' },
        text: `❌ LỖI POLLING: ${error.message}\n\n🔧 Vui lòng kiểm tra và cập nhật:\n• Access Token\n• Cookie\n• Video ID\n\nClick "Dừng Polling" và cấu hình lại.`,
        timestamp: Date.now(),
        metadata: {
          isError: true,
          errorType: 'polling_error',
          originalError: error.message
        },
      };

      // Broadcast error comment to dashboard
      io.to(roomId).emit("facebook_comment", [errorComment]);

      // Stop polling on error
      if (roomData.commentPolling) {
        roomData.commentPolling();
        roomData.commentPolling = null;
        console.log(`[COMMENT POLLING] Auto-stopped due to error in room ${roomId}`);
      }
    }
  ).then(stopFn => {
    roomData.commentPolling = stopFn;
  });
}




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

        // Handle state changes for control actions
        const roomData = gameRooms.get(room);
        if (roomData) {
          if (action === ACTIONS.INIT_GAME) {
            roomData.state = GAME_STATES.INIT;
            roomData.addedPlayerIds.clear();
            console.log(`[INIT_GAME] Game state set to INIT, cleared player tracking`);
            io.to(room).emit('game_state_changed', { state: GAME_STATES.INIT });
          } else if (action === ACTIONS.RUN_GAME) {
            roomData.state = GAME_STATES.PLAYING;
            console.log(`[RUN_GAME] Game state set to PLAYING`);
            io.to(room).emit('game_state_changed', { state: GAME_STATES.PLAYING });
          } else if (action === ACTIONS.RESET_GAME) {
            roomData.state = GAME_STATES.PENDING;
            roomData.addedPlayerIds.clear();
            console.log(`[RESET_GAME] Game state set to PENDING, cleared player tracking`);
            io.to(room).emit('game_state_changed', { state: GAME_STATES.PENDING });
          }
        }

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

    // Handle pin/unpin comment events
    if (endpoint === "pin.comment") {
      const { room, commentId, pinned } = data;

      // Broadcast to all clients in room (including showcmt)
      io.to(room).emit("pin_comment", {
        commentId: commentId,
        pinned: pinned
      });

      console.log(`[PIN] Broadcasted pin event for comment ${commentId} (pinned: ${pinned}) to room ${room}`);

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