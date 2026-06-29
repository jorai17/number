// roomManager.js
const { GameState } = require("./gameLogic");

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // bỏ ký tự dễ nhầm (0,O,1,I)
const MAX_PLAYERS = 6;
const MIN_PLAYERS_TO_START = 2;
const INTER_GAME_WAIT_MS = 30 * 60 * 1000; // 30 phút chờ giữa các ván

function genRoomCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

class Room {
  constructor(code, hostId) {
    this.code = code;
    this.hostId = hostId;
    this.isPublic = true;
    // slots: mảng 6 vị trí cố định theo lục giác, mỗi slot là player object hoặc null
    this.slots = new Array(MAX_PLAYERS).fill(null);
    this.players = new Map(); // id -> { id, name, avatar, slot }
    this.chat = []; // { id, name, text, ts }
    this.game = null; // GameState | null
    this.lobbyPhase = "lobby"; // "lobby" | "playing" | "ended_waiting"
    this.nextGameAvailableAt = 0;
    this.createdAt = Date.now();
  }

  get playerCount() {
    return this.players.size;
  }

  isEmpty() {
    return this.players.size === 0;
  }

  addPlayer(id, name, avatar) {
    if (this.players.has(id)) return { ok: true };
    const freeSlot = this.slots.findIndex((s) => s === null);
    if (freeSlot === -1) return { ok: false, reason: "room_full" };
    const player = { id, name, avatar, slot: freeSlot };
    this.slots[freeSlot] = player;
    this.players.set(id, player);
    return { ok: true, slot: freeSlot };
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.slots[p.slot] = null;
    this.players.delete(id);
    if (this.hostId === id) {
      // chuyển host cho người còn lại đầu tiên (theo thứ tự slot)
      const remaining = this.slots.filter((s) => s !== null);
      this.hostId = remaining.length > 0 ? remaining[0].id : null;
    }
  }

  movePlayer(id, targetSlot) {
    if (targetSlot < 0 || targetSlot >= MAX_PLAYERS) return { ok: false, reason: "invalid_slot" };
    if (this.slots[targetSlot] !== null) return { ok: false, reason: "slot_taken" };
    const p = this.players.get(id);
    if (!p) return { ok: false, reason: "not_in_room" };
    this.slots[p.slot] = null;
    p.slot = targetSlot;
    this.slots[targetSlot] = p;
    return { ok: true };
  }

  canStart() {
    return this.lobbyPhase !== "playing" && this.playerCount >= MIN_PLAYERS_TO_START;
  }

  startGame() {
    if (!this.canStart()) return { ok: false };
    // Thứ tự lục giác = thứ tự slot 0..5 (đã cố định vị trí hình học ở client theo index slot)
    const playersInOrder = this.slots
      .map((s, idx) => (s ? { id: s.id, name: s.name, slotIndex: idx } : null))
      .filter(Boolean);
    if (playersInOrder.length < MIN_PLAYERS_TO_START) return { ok: false };
    const starterIdx = Math.floor(Math.random() * playersInOrder.length);
    this.game = new GameState(
      playersInOrder.map((p) => ({ id: p.id, name: p.name })),
      starterIdx
    );
    this.lobbyPhase = "playing";
    return { ok: true };
  }

  endGameToLobby() {
    this.game = null;
    this.lobbyPhase = "lobby";
  }

  toLobbyPublicState() {
    return {
      code: this.code,
      isPublic: this.isPublic,
      hostId: this.hostId,
      lobbyPhase: this.lobbyPhase,
      slots: this.slots.map((s) =>
        s ? { id: s.id, name: s.name, avatar: s.avatar, slot: s.slot } : null
      ),
      playerCount: this.playerCount,
      maxPlayers: MAX_PLAYERS,
      canStart: this.canStart(),
    };
  }

  toBrowserSummary() {
    return {
      code: this.code,
      isPublic: this.isPublic,
      playerCount: this.playerCount,
      maxPlayers: MAX_PLAYERS,
      lobbyPhase: this.lobbyPhase,
    };
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map(); // code -> Room
  }

  createRoom(hostId) {
    let code;
    do {
      code = genRoomCode();
    } while (this.rooms.has(code));
    const room = new Room(code, hostId);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get((code || "").toUpperCase());
  }

  removeRoomIfEmpty(code) {
    const room = this.rooms.get(code);
    if (room && room.isEmpty()) {
      this.rooms.delete(code);
    }
  }

  listPublicRooms() {
    return [...this.rooms.values()]
      .filter((r) => r.isPublic && r.playerCount > 0)
      .map((r) => r.toBrowserSummary());
  }

  searchRoomByCode(code) {
    const room = this.getRoom(code);
    return room ? room.toBrowserSummary() : null;
  }
}

module.exports = { RoomManager, Room, MAX_PLAYERS, MIN_PLAYERS_TO_START, INTER_GAME_WAIT_MS };
