// gameLogic.js
// Toàn bộ logic luật chơi "Đếm số 1-30" cho một phòng.
// Mỗi Room sở hữu một đối tượng GameState khi ván đang diễn ra.

const MAX_NUMBER = 30;
const HALF_NUMBER = MAX_NUMBER / 2; // 15 - ngưỡng để được đổi lại 1 ô đã đổi
const BASE_TURN_TIME = 10; // giây nhập số khi tới lượt
const MIN_TURN_TIME = 3; // giây tối thiểu
const TURN_TIME_DECAY_EVERY = 15; // mỗi 15 vòng giảm 1 giây
const SWAP_TIME = 30; // giây để người thắng vòng đổi từ
const MAX_WORD_LEN = 10;

function clampTurnTime(roundCount) {
  // roundCount: số vòng (lượt đếm 1->30) đã hoàn thành trong toàn ván
  const decay = Math.floor(roundCount / TURN_TIME_DECAY_EVERY);
  const t = BASE_TURN_TIME - decay;
  return Math.max(MIN_TURN_TIME, t);
}

class GameState {
  /**
   * @param {Array<{id, name}>} playersInOrder - người chơi theo thứ tự lục giác (chiều kim đồng hồ)
   * @param {number} starterIndex - index trong playersInOrder của người giữ thẻ "1" đầu tiên
   */
  constructor(playersInOrder, starterIndex) {
    // Danh sách cố định vị trí (không đổi trong suốt ván, chỉ đổi khi người bị loại -> bị bỏ qua)
    this.order = playersInOrder.map((p) => p.id); // mảng id theo đúng vị trí lục giác, cố định
    this.names = {};
    playersInOrder.forEach((p) => (this.names[p.id] = p.name));

    // Cells: giá trị hiện tại của 30 ô. cells[i] = { value: string, original: number, swapCount: number, lastSwappedAtRound: number|null }
    this.cells = Array.from({ length: MAX_NUMBER }, (_, i) => ({
      value: String(i + 1),
      original: i + 1,
      swapCount: 0,
      lastSwappedAtRound: null, // số ô đã đổi tại thời điểm ô này được đổi lần gần nhất
    }));

    this.alive = new Set(this.order); // người chơi còn sống (chưa bị loại)
    this.spectators = new Set(); // người bị loại - khán giả

    this.holderIndex = starterIndex; // index trong this.order của người giữ thẻ "1"
    this.currentIndex = starterIndex; // index của người đang phải nhập (con trỏ lượt)
    this.currentTarget = 1; // giá trị đích hiện tại cần nhập đúng (số thứ tự ô, 1..30)
    this.expectedCellIndex = 0; // ô (0-based) ứng với currentTarget hiện tại trên dãy đếm

    this.totalSwapsDone = 0; // tổng số lượt đổi từ đã xảy ra trong toàn ván (mọi vòng cộng lại) - dùng cho rule "phải sau 15 lần đổi nữa"
    this.roundsCompleted = 0; // số vòng 1->30 đã hoàn thành (dùng tính turn time)

    this.phase = "counting"; // "counting" | "swapping" | "finished"
    this.pendingSwapBy = null; // id người đang có quyền đổi từ
    this.winnerId = null;

    this.turnStartedAt = Date.now();
    this.turnDuration = clampTurnTime(this.roundsCompleted);
  }

  aliveOrderFromIndex(startIdx) {
    // Trả về danh sách index (trong this.order) của người còn sống, bắt đầu từ startIdx đi tiếp theo chiều kim đồng hồ
    const n = this.order.length;
    const res = [];
    for (let k = 0; k < n; k++) {
      const idx = (startIdx + k) % n;
      if (this.alive.has(this.order[idx])) res.push(idx);
    }
    return res;
  }

  nextAliveIndex(fromIdx) {
    const n = this.order.length;
    for (let k = 1; k <= n; k++) {
      const idx = (fromIdx + k) % n;
      if (this.alive.has(this.order[idx])) return idx;
    }
    return -1; // không còn ai
  }

  currentPlayerId() {
    return this.order[this.currentIndex];
  }

  holderPlayerId() {
    return this.order[this.holderIndex];
  }

  isCellSwapped(cellIdx) {
    return this.cells[cellIdx].value !== String(this.cells[cellIdx].original);
  }

  // Người chơi (id) cố nhập giá trị `raw` khi đến lượt mình.
  // Trả về { ok, eliminated: id|null, advanced, finishedRound, winnerId }
  submitNumber(playerId, raw) {
    if (this.phase !== "counting") return { ok: false, reason: "not_counting" };
    if (this.currentPlayerId() !== playerId) return { ok: false, reason: "not_your_turn" };

    const expected = this.cells[this.expectedCellIndex].value;
    const input = String(raw).trim();
    const correct = input === expected;

    if (correct) {
      const completedCellIdx = this.expectedCellIndex;
      const wasLastCell = completedCellIdx === MAX_NUMBER - 1;

      if (wasLastCell) {
        // Vòng hoàn thành! playerId hiện tại có quyền đổi từ.
        this.roundsCompleted += 1;
        this.phase = "swapping";
        this.pendingSwapBy = playerId;
        this.turnStartedAt = Date.now();
        this.turnDuration = SWAP_TIME;
        return { ok: true, correct: true, finishedRound: true, swapperId: playerId };
      } else {
        // Tiến tiếp bình thường
        this.expectedCellIndex += 1;
        this.currentTarget += 1;
        const nextIdx = this.nextAliveIndex(this.currentIndex);
        if (nextIdx === -1) {
          // Không còn ai khác sống -> người này thắng (trường hợp hiếm, an toàn)
          return this._declareWinner(playerId);
        }
        this.currentIndex = nextIdx;
        this.turnStartedAt = Date.now();
        this.turnDuration = clampTurnTime(this.roundsCompleted);
        return { ok: true, correct: true, finishedRound: false };
      }
    } else {
      // Sai -> loại người chơi này
      this.eliminate(playerId);
      const remaining = this.alive.size;
      if (remaining <= 1) {
        const winnerId = remaining === 1 ? [...this.alive][0] : null;
        return this._declareWinner(winnerId, { eliminated: playerId, wrongValue: input });
      }
      // Người tiếp theo phải nhập lại đúng giá trị mà người bị loại vừa nhập sai (KHÔNG tăng expectedCellIndex).
      // currentIndex vừa bị loại khỏi alive nên nextAliveIndex(currentIndex) sẽ tìm đúng người kế tiếp theo kim đồng hồ.
      this.currentIndex = this.nextAliveIndex(this.currentIndex);
      this.turnStartedAt = Date.now();
      this.turnDuration = clampTurnTime(this.roundsCompleted);
      return {
        ok: true,
        correct: false,
        eliminated: playerId,
        wrongValue: input,
        expectedValue: expected,
        nextPlayerId: this.currentPlayerId(),
      };
    }
  }

  eliminate(playerId) {
    this.alive.delete(playerId);
    this.spectators.add(playerId);
  }

  _declareWinner(winnerId, extra = {}) {
    this.phase = "finished";
    this.winnerId = winnerId;
    return { ok: true, gameFinished: true, winnerId, ...extra };
  }

  // Người có quyền đổi từ (pendingSwapBy) thực hiện đổi cellIndex (0-based) thành newWord
  submitSwap(playerId, cellIndex, newWord) {
    if (this.phase !== "swapping") return { ok: false, reason: "not_swapping" };
    if (this.pendingSwapBy !== playerId) return { ok: false, reason: "not_your_swap" };
    if (cellIndex < 0 || cellIndex >= MAX_NUMBER) return { ok: false, reason: "invalid_cell" };

    const word = String(newWord).trim();
    if (!word || word.length > MAX_WORD_LEN) return { ok: false, reason: "invalid_word_length" };

    const cell = this.cells[cellIndex];
    const alreadySwapped = this.isCellSwapped(cellIndex);
    const totalSwappedCells = this.cells.filter((_, i) => this.isCellSwapped(i)).length;

    if (!alreadySwapped) {
      // Đổi lần đầu cho ô này - luôn được phép (chưa từng đổi)
    } else {
      // Ô này đã từng bị đổi - chỉ được đổi lại nếu đã có >= 15 ô bị đổi VÀ
      // đã qua ít nhất 15 lượt đổi (totalSwapsDone) kể từ lần đổi gần nhất của CHÍNH ô này
      if (totalSwappedCells < HALF_NUMBER) {
        return { ok: false, reason: "half_not_reached" };
      }
      const swapsSince = this.totalSwapsDone - (cell.lastSwappedAtRound ?? 0);
      if (swapsSince < HALF_NUMBER) {
        return { ok: false, reason: "too_soon_to_reswap" };
      }
    }

    // Không được đổi về giá trị gốc của chính ô đó, và không được đổi thành giá trị hiện tại của nó (vô nghĩa)
    if (word === String(cell.original)) {
      return { ok: false, reason: "cannot_revert_to_original" };
    }
    if (word === cell.value) {
      return { ok: false, reason: "same_as_current" };
    }
    // Không được trùng với giá trị hiện tại của một ô khác (tránh đếm bị mơ hồ)
    const duplicate = this.cells.some((c, i) => i !== cellIndex && c.value === word);
    if (duplicate) {
      return { ok: false, reason: "duplicate_value" };
    }

    const oldValue = cell.value;
    cell.value = word;
    cell.swapCount += 1;
    this.totalSwapsDone += 1;
    cell.lastSwappedAtRound = this.totalSwapsDone;

    // Chuyển thẻ "1" sang người kế tiếp theo kim đồng hồ (theo vị trí lục giác cố định, không phụ thuộc còn sống hay không
    // -- nhưng người giữ thẻ thực tế bắt đầu đếm phải là người sống gần nhất theo kim đồng hồ từ vị trí đó)
    const nextHolderRaw = (this.holderIndex + 1) % this.order.length;
    this.holderIndex = nextHolderRaw;

    let startIdx = this.holderIndex;
    if (!this.alive.has(this.order[startIdx])) {
      const found = this.nextAliveIndex(startIdx - 1 >= 0 ? startIdx - 1 : this.order.length - 1);
      startIdx = found !== -1 ? found : startIdx;
    }

    this.phase = "counting";
    this.pendingSwapBy = null;
    this.currentIndex = startIdx;
    this.currentTarget = 1;
    this.expectedCellIndex = 0;
    this.turnStartedAt = Date.now();
    this.turnDuration = clampTurnTime(this.roundsCompleted);

    return {
      ok: true,
      cellIndex,
      oldValue,
      newValue: word,
      nextHolderId: this.order[this.holderIndex],
      nextCurrentPlayerId: this.currentPlayerId(),
    };
  }

  // Hết giờ đổi từ mà không đổi -> tự động bỏ qua, chuyển vòng mới mà KHÔNG đổi ô nào
  forceSkipSwap() {
    if (this.phase !== "swapping") return null;
    const nextHolderRaw = (this.holderIndex + 1) % this.order.length;
    this.holderIndex = nextHolderRaw;
    let startIdx = this.holderIndex;
    if (!this.alive.has(this.order[startIdx])) {
      const found = this.nextAliveIndex(startIdx - 1 >= 0 ? startIdx - 1 : this.order.length - 1);
      startIdx = found !== -1 ? found : startIdx;
    }
    this.phase = "counting";
    this.pendingSwapBy = null;
    this.currentIndex = startIdx;
    this.currentTarget = 1;
    this.expectedCellIndex = 0;
    this.turnStartedAt = Date.now();
    this.turnDuration = clampTurnTime(this.roundsCompleted);
    return { nextCurrentPlayerId: this.currentPlayerId() };
  }

  // Hết giờ nhập số mà không nhập -> coi như nhập sai -> bị loại
  forceTimeoutCurrentPlayer() {
    if (this.phase !== "counting") return null;
    const playerId = this.currentPlayerId();
    return { playerId, result: this.submitNumber(playerId, "__TIMEOUT__") };
  }

  // Kiểm tra 1 chuỗi chat có trùng với bất kỳ giá trị đã ĐỔI nào trong 30 ô không (để chặn hiện chat)
  isMessageBlockedAsSwappedWord(text) {
    const t = String(text).trim();
    if (!t) return false;
    return this.cells.some((c, i) => this.isCellSwapped(i) && c.value === t);
  }

  remainingTurnSeconds() {
    const elapsed = (Date.now() - this.turnStartedAt) / 1000;
    return Math.max(0, this.turnDuration - elapsed);
  }

  toPublicState() {
    return {
      order: this.order,
      cells: this.cells.map((c) => ({ value: c.value, swapped: c.value !== String(c.original) })),
      alive: [...this.alive],
      spectators: [...this.spectators],
      holderId: this.order[this.holderIndex],
      currentPlayerId: this.phase === "counting" ? this.currentPlayerId() : null,
      currentTarget: this.currentTarget,
      phase: this.phase,
      pendingSwapBy: this.pendingSwapBy,
      winnerId: this.winnerId,
      turnStartedAt: this.turnStartedAt,
      turnDuration: this.turnDuration,
      totalSwapsDone: this.totalSwapsDone,
      roundsCompleted: this.roundsCompleted,
    };
  }
}

module.exports = {
  GameState,
  MAX_NUMBER,
  HALF_NUMBER,
  SWAP_TIME,
  MAX_WORD_LEN,
  clampTurnTime,
};
