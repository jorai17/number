// index.js - Server chính
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const { RoomManager, MIN_PLAYERS_TO_START, INTER_GAME_WAIT_MS } = require("./roomManager");
const { MAX_NUMBER } = require("./gameLogic");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, "..", "public")));

const roomManager = new RoomManager();

// socket.id -> { roomCode }
const socketMeta = new Map();

// roomCode -> { turnTimer, swapTimer, waitTimer }
const roomTimers = new Map();

function getTimers(code) {
  if (!roomTimers.has(code)) roomTimers.set(code, {});
  return roomTimers.get(code);
}

function clearAllTimers(code) {
  const t = roomTimers.get(code);
  if (!t) return;
  if (t.turnTimer) clearTimeout(t.turnTimer);
  if (t.swapTimer) clearTimeout(t.swapTimer);
  if (t.waitTimer) clearTimeout(t.waitTimer);
  roomTimers.delete(code);
}

function broadcastLobby(room) {
  io.to(room.code).emit("lobby:update", room.toLobbyPublicState());
}

function broadcastGame(room) {
  if (!room.game) return;
  io.to(room.code).emit("game:update", room.game.toPublicState());
}

function broadcastPublicRoomList() {
  io.emit("rooms:list", roomManager.listPublicRooms());
}

function scheduleTurnTimer(room) {
  const code = room.code;
  const timers = getTimers(code);
  if (timers.turnTimer) clearTimeout(timers.turnTimer);
  if (!room.game || room.game.phase !== "counting") return;

  const ms = room.game.remainingTurnSeconds() * 1000;
  timers.turnTimer = setTimeout(() => {
    handleTurnTimeout(room);
  }, Math.max(50, ms));
}

function scheduleSwapTimer(room) {
  const code = room.code;
  const timers = getTimers(code);
  if (timers.swapTimer) clearTimeout(timers.swapTimer);
  if (!room.game || room.game.phase !== "swapping") return;

  const ms = room.game.remainingTurnSeconds() * 1000;
  timers.swapTimer = setTimeout(() => {
    handleSwapTimeout(room);
  }, Math.max(50, ms));
}

function handleTurnTimeout(room) {
  if (!room.game || room.game.phase !== "counting") return;
  const r = room.game.forceTimeoutCurrentPlayer();
  if (!r) return;
  const { playerId, result } = r;
  io.to(room.code).emit("game:eliminated", {
    playerId,
    reason: "timeout",
    expectedValue: result.expectedValue || null,
  });
  afterSubmitResult(room, result);
}

function handleSwapTimeout(room) {
  if (!room.game || room.game.phase !== "swapping") return;
  const r = room.game.forceSkipSwap();
  io.to(room.code).emit("game:swapSkipped", {});
  broadcastGame(room);
  scheduleTurnTimer(room);
}

function afterSubmitResult(room, result) {
  if (result.gameFinished) {
    io.to(room.code).emit("game:over", { winnerId: result.winnerId });
    broadcastGame(room);
    clearAllTimers(room.code);
    const timers = getTimers(room.code);
    room.lobbyPhase = "ended_waiting";
    room.nextGameAvailableAt = Date.now() + INTER_GAME_WAIT_MS;
    broadcastLobby(room);
    timers.waitTimer = setTimeout(() => {
      room.endGameToLobby();
      broadcastLobby(room);
    }, INTER_GAME_WAIT_MS);
    return;
  }
  if (result.finishedRound) {
    io.to(room.code).emit("game:roundComplete", { swapperId: result.swapperId });
    broadcastGame(room);
    scheduleSwapTimer(room);
    return;
  }
  broadcastGame(room);
  scheduleTurnTimer(room);
}

io.on("connection", (socket) => {
  socket.on("player:join", ({ roomCode, name, avatar, action }, cb) => {
    try {
      name = String(name || "Người chơi").slice(0, 20).trim() || "Người chơi";
      avatar = String(avatar || "🙂");

      let room;
      if (action === "create") {
        room = roomManager.createRoom(socket.id);
      } else {
        room = roomManager.getRoom(roomCode);
        if (!room) return cb && cb({ ok: false, reason: "room_not_found" });
        if (room.players.size >= 6 && !room.players.has(socket.id)) {
          return cb && cb({ ok: false, reason: "room_full" });
        }
      }

      const res = room.addPlayer(socket.id, name, avatar);
      if (!res.ok) return cb && cb({ ok: false, reason: res.reason });

      socket.join(room.code);
      socketMeta.set(socket.id, { roomCode: room.code });

      cb && cb({ ok: true, roomCode: room.code, youAre: socket.id });
      broadcastLobby(room);
      broadcastPublicRoomList();
      if (room.game) {
        socket.emit("game:update", room.game.toPublicState());
      }
    } catch (err) {
      console.error(err);
      cb && cb({ ok: false, reason: "server_error" });
    }
  });

  socket.on("rooms:browse", (cb) => {
    cb && cb({ ok: true, rooms: roomManager.listPublicRooms() });
  });

  socket.on("rooms:searchByCode", ({ code }, cb) => {
    const summary = roomManager.searchRoomByCode(code);
    cb && cb({ ok: !!summary, room: summary });
  });

  socket.on("room:move", ({ targetSlot }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    const room = roomManager.getRoom(meta.roomCode);
    if (!room || room.lobbyPhase === "playing") return;
    const res = room.movePlayer(socket.id, targetSlot);
    if (res.ok) broadcastLobby(room);
  });

  socket.on("room:setPublic", ({ isPublic }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    const room = roomManager.getRoom(meta.roomCode);
    if (!room || room.hostId !== socket.id) return;
    room.isPublic = !!isPublic;
    broadcastLobby(room);
    broadcastPublicRoomList();
  });

  socket.on("room:kick", ({ targetId }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    const room = roomManager.getRoom(meta.roomCode);
    if (!room || room.hostId !== socket.id) return;
    if (targetId === socket.id) return;
    if (!room.players.has(targetId)) return;

    room.removePlayer(targetId);
    io.to(targetId).emit("room:kicked");
    io.sockets.sockets.get(targetId)?.leave(room.code);
    socketMeta.delete(targetId);

    broadcastLobby(room);
    broadcastPublicRoomList();
  });

  socket.on("room:start", (cb) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return cb && cb({ ok: false });
    const room = roomManager.getRoom(meta.roomCode);
    if (!room || room.hostId !== socket.id) return cb && cb({ ok: false, reason: "not_host" });
    if (!room.canStart()) return cb && cb({ ok: false, reason: "cannot_start" });

    // Nếu đang ở trạng thái chờ giữa 2 ván, hủy bộ đếm tự-về-lobby vì sắp bắt đầu ván mới ngay
    const timers = getTimers(room.code);
    if (timers.waitTimer) {
      clearTimeout(timers.waitTimer);
      timers.waitTimer = null;
    }

    const res = room.startGame();
    if (!res.ok) return cb && cb({ ok: false });

    cb && cb({ ok: true });
    io.to(room.code).emit("game:started");
    broadcastLobby(room);
    broadcastGame(room);
    scheduleTurnTimer(room);
  });

  // Người chơi nhập số khi tới lượt
  socket.on("game:submitNumber", ({ value }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    const room = roomManager.getRoom(meta.roomCode);
    if (!room || !room.game) return;
    if (room.game.phase !== "counting") return;
    if (room.game.currentPlayerId() !== socket.id) return;

    const result = room.game.submitNumber(socket.id, value);
    if (!result.ok) return;

    if (result.correct === false) {
      io.to(room.code).emit("game:eliminated", {
        playerId: socket.id,
        reason: "wrong_value",
        wrongValue: result.wrongValue,
        expectedValue: result.expectedValue,
      });
    } else if (result.correct === true && !result.finishedRound && !result.gameFinished) {
      io.to(room.code).emit("game:correct", { playerId: socket.id, value: String(value).trim() });
    }

    afterSubmitResult(room, result);
  });

  // Người có quyền đổi từ thực hiện đổi
  socket.on("game:submitSwap", ({ cellIndex, newWord }, cb) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return cb && cb({ ok: false });
    const room = roomManager.getRoom(meta.roomCode);
    if (!room || !room.game) return cb && cb({ ok: false });
    if (room.game.phase !== "swapping") return cb && cb({ ok: false, reason: "not_swapping" });

    const result = room.game.submitSwap(socket.id, cellIndex, newWord);
    if (!result.ok) return cb && cb({ ok: false, reason: result.reason });

    cb && cb({ ok: true });
    io.to(room.code).emit("game:swapped", {
      cellIndex: result.cellIndex,
      oldValue: result.oldValue,
      newValue: result.newValue,
      byPlayerId: socket.id,
    });
    broadcastGame(room);
    scheduleTurnTimer(room);
  });

  // Chat: nếu không tới lượt, gửi vào thanh chat phía trên; nếu trùng từ đã đổi thì bị chặn
  socket.on("chat:send", ({ text }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    const room = roomManager.getRoom(meta.roomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;

    const trimmed = String(text || "").slice(0, 200).trim();
    if (!trimmed) return;

    if (room.game && room.game.isMessageBlockedAsSwappedWord(trimmed)) {
      // Bị chặn: không phát cho ai, có thể báo riêng cho người gửi
      socket.emit("chat:blocked", { text: trimmed });
      return;
    }

    const msg = { id: socket.id, name: player.name, text: trimmed, ts: Date.now() };
    room.chat.push(msg);
    if (room.chat.length > 200) room.chat.shift();
    io.to(room.code).emit("chat:message", msg);
  });

  socket.on("room:leave", () => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    const room = roomManager.getRoom(meta.roomCode);
    if (!room) return;

    handlePlayerLeaveRoom(socket, room);
    socket.leave(room.code);
    socketMeta.delete(socket.id);
    socket.emit("room:leftConfirmed");
  });

  socket.on("disconnect", () => {
    const meta = socketMeta.get(socket.id);
    socketMeta.delete(socket.id);
    if (!meta) return;
    const room = roomManager.getRoom(meta.roomCode);
    if (!room) return;

    handlePlayerLeaveRoom(socket, room);
  });
});

function handlePlayerLeaveRoom(socket, room) {
  const wasInGame = !!room.game;
  const wasAlive = wasInGame && room.game.alive.has(socket.id);
  const wasCurrentTurn =
    wasInGame && room.game.phase === "counting" && room.game.currentPlayerId() === socket.id;

  room.removePlayer(socket.id);

  if (wasInGame && wasAlive) {
    if (wasCurrentTurn) {
      // Người rời đi đang giữ lượt -> xử lý như timeout, dùng đúng 1 đường xử lý loại (eliminate + advance turn)
      const r = room.game.forceTimeoutCurrentPlayer();
      if (r) afterSubmitResult(room, r.result);
    } else {
      // Người rời đi không phải lượt hiện tại -> loại trực tiếp, không cần advance turn pointer
      room.game.eliminate(socket.id);
      if (room.game.alive.size <= 1 && room.game.phase !== "finished") {
        const winnerId = room.game.alive.size === 1 ? [...room.game.alive][0] : null;
        const result = room.game._declareWinner(winnerId);
        afterSubmitResult(room, result);
      } else {
        broadcastGame(room);
      }
    }
  }

  if (room.isEmpty()) {
    clearAllTimers(room.code);
    roomManager.removeRoomIfEmpty(room.code);
  } else {
    broadcastLobby(room);
  }
  broadcastPublicRoomList();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Number Game server đang chạy tại http://localhost:${PORT}`);
});
