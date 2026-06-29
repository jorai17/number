// app.js - Client logic
(function () {
  "use strict";

  const socket = io();

  const AVATARS = ["🙂", "😎", "🤖", "🐱", "🐸", "🦊", "🐼", "🦁", "🐵", "👻", "🎃", "🌟"];
  const MAX_SLOTS = 6;

  // ============ State ============
  let myId = null;
  let myName = "";
  let myAvatar = AVATARS[0];
  let currentRoomCode = null;
  let lastLobbyState = null;
  let lastGameState = null;
  let isHost = false;
  let turnCountdownInterval = null;
  let swapCountdownInterval = null;
  let selectedSwapCell = null;

  // ============ DOM refs ============
  const screens = {
    home: document.getElementById("screen-home"),
    find: document.getElementById("screen-find"),
    room: document.getElementById("screen-room"),
  };

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
  }

  function toast(msg, type) {
    const el = document.createElement("div");
    el.className = "toast" + (type ? " " + type : "");
    el.textContent = msg;
    document.getElementById("toastContainer").appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  // ============ HOME SCREEN setup ============
  const avatarPicker = document.getElementById("avatarPicker");
  const avatarPreview = document.getElementById("avatarPreview");
  const nameInput = document.getElementById("nameInput");

  AVATARS.forEach((av, i) => {
    const btn = document.createElement("button");
    btn.className = "avatar-option" + (i === 0 ? " selected" : "");
    btn.textContent = av;
    btn.type = "button";
    btn.addEventListener("click", () => {
      myAvatar = av;
      avatarPreview.textContent = av;
      document.querySelectorAll(".avatar-option").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
    avatarPicker.appendChild(btn);
  });

  nameInput.addEventListener("input", () => {
    myName = nameInput.value.trim();
  });

  function getNameOrDefault() {
    return nameInput.value.trim() || "Người chơi";
  }

  document.getElementById("btnCreateRoom").addEventListener("click", () => {
    myName = getNameOrDefault();
    socket.emit("player:join", { action: "create", name: myName, avatar: myAvatar }, (res) => {
      if (!res.ok) return toast("Không thể tạo phòng, thử lại.", "danger");
      myId = res.youAre;
      currentRoomCode = res.roomCode;
      showScreen("room");
    });
  });

  document.getElementById("btnFindRoom").addEventListener("click", () => {
    showScreen("find");
    refreshPublicRoomsList();
  });

  // ============ RULES MODAL ============
  const rulesModal = document.getElementById("rulesModal");
  document.getElementById("btnShowRules").addEventListener("click", () => {
    rulesModal.classList.remove("hidden");
  });
  document.getElementById("btnCloseRules").addEventListener("click", () => {
    rulesModal.classList.add("hidden");
  });
  rulesModal.addEventListener("click", (e) => {
    if (e.target === rulesModal) rulesModal.classList.add("hidden");
  });

  document.getElementById("btnBackFromFind").addEventListener("click", () => {
    showScreen("home");
  });

  // ============ FIND ROOM SCREEN ============
  function refreshPublicRoomsList() {
    socket.emit("rooms:browse", (res) => {
      renderPublicRoomsList(res.rooms || []);
    });
  }

  function renderPublicRoomsList(rooms) {
    const container = document.getElementById("publicRoomsList");
    container.innerHTML = "";
    if (rooms.length === 0) {
      container.innerHTML = '<p class="empty-hint">Chưa có phòng công khai nào.</p>';
      return;
    }
    rooms.forEach((r) => {
      const card = document.createElement("div");
      card.className = "public-room-card";
      const statusText =
        r.lobbyPhase === "playing"
          ? "Đang chơi"
          : r.lobbyPhase === "ended_waiting"
          ? "Chờ ván mới"
          : "Đang chờ";
      card.innerHTML = `
        <div>
          <div class="room-code">${r.code}</div>
          <div class="room-info">${r.playerCount}/${r.maxPlayers} người · ${statusText}</div>
        </div>
        <button type="button">Vào</button>
      `;
      card.querySelector("button").addEventListener("click", () => joinRoomByCode(r.code));
      container.appendChild(card);
    });
  }

  socket.on("rooms:list", (rooms) => {
    if (screens.find.classList.contains("active")) {
      renderPublicRoomsList(rooms);
    }
  });

  document.getElementById("btnSearchRoom").addEventListener("click", () => {
    const code = document.getElementById("roomCodeSearchInput").value.trim().toUpperCase();
    if (!code) return;
    socket.emit("rooms:searchByCode", { code }, (res) => {
      const resultEl = document.getElementById("searchResult");
      if (!res.ok || !res.room) {
        resultEl.innerHTML = '<p class="empty-hint">Không tìm thấy phòng với mã này.</p>';
        return;
      }
      const r = res.room;
      resultEl.innerHTML = `
        <div class="public-room-card">
          <div>
            <div class="room-code">${r.code}</div>
            <div class="room-info">${r.playerCount}/${r.maxPlayers} người ${r.isPublic ? "· Công khai" : "· Riêng tư"}</div>
          </div>
          <button type="button">Vào</button>
        </div>
      `;
      resultEl.querySelector("button").addEventListener("click", () => joinRoomByCode(r.code));
    });
  });

  document.getElementById("roomCodeSearchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btnSearchRoom").click();
  });
  document.getElementById("roomCodeSearchInput").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  function joinRoomByCode(code) {
    myName = getNameOrDefault();
    socket.emit("player:join", { action: "join", roomCode: code, name: myName, avatar: myAvatar }, (res) => {
      if (!res.ok) {
        const msg =
          res.reason === "room_not_found"
            ? "Không tìm thấy phòng."
            : res.reason === "room_full"
            ? "Phòng đã đầy."
            : "Không thể vào phòng.";
        return toast(msg, "danger");
      }
      myId = res.youAre;
      currentRoomCode = res.roomCode;
      showScreen("room");
    });
  }

  // ============ ROOM SCREEN: Hexagon layout ============
  // 6 vị trí lục giác đều, tâm hình tròn nằm trên đỉnh lục giác.
  // Đỉnh đầu tiên ở trên cùng (12h), các đỉnh còn lại cách đều 60 độ.
  function hexagonPositions(cx, cy, radius) {
    const positions = [];
    for (let i = 0; i < 6; i++) {
      const angle = (-90 + i * 60) * (Math.PI / 180); // bắt đầu từ đỉnh trên cùng, theo chiều kim đồng hồ
      positions.push({
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    }
    return positions;
  }

  const hexagonArena = document.getElementById("hexagonArena");
  let slotElements = []; // 6 elements

  function renderHexagonSlots() {
    hexagonArena.querySelectorAll(".player-slot").forEach((el) => el.remove());
    slotElements = [];

    const rect = hexagonArena.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const radius = Math.min(rect.width, rect.height) * 0.32;
    const positions = hexagonPositions(cx, cy, radius);

    for (let i = 0; i < MAX_SLOTS; i++) {
      const el = document.createElement("div");
      el.className = "player-slot";
      el.style.left = positions[i].x + "px";
      el.style.top = positions[i].y + "px";
      el.dataset.slotIndex = i;
      hexagonArena.insertBefore(el, document.getElementById("arenaCenter"));
      slotElements.push(el);
    }
  }

  function avatarHtmlFor(player, slotIndex, lobby) {
    if (!player) {
      return `<div class="slot-empty" data-empty-slot="${slotIndex}">Trống</div>`;
    }
    return `
      <div class="slot-avatar-wrap">
        <div class="slot-avatar">${player.avatar}</div>
      </div>
    `;
  }

  function renderLobby(state) {
    lastLobbyState = state;
    isHost = state.hostId === myId;

    document.getElementById("roomCodeBadge").textContent = state.code;

    const togglePublicBtn = document.getElementById("btnTogglePublic");
    togglePublicBtn.classList.toggle("hidden", !isHost);
    togglePublicBtn.classList.remove("is-public", "is-private");
    togglePublicBtn.classList.add(state.isPublic ? "is-public" : "is-private");
    togglePublicBtn.textContent = state.isPublic ? "🌐 Công khai" : "🔒 Riêng tư";

    const startBtn = document.getElementById("btnStartGame");
    const announcementEl = document.getElementById("centerAnnouncement");
    const waitingEl = document.getElementById("waitingNextGame");

    if (state.lobbyPhase === "playing") {
      startBtn.classList.add("hidden");
      waitingEl.classList.add("hidden");
    } else if (state.lobbyPhase === "ended_waiting") {
      waitingEl.classList.remove("hidden");
      startWaitingCountdown();
      startBtn.classList.remove("hidden");
      startBtn.disabled = !(isHost && state.canStart);
      startBtn.textContent = isHost
        ? state.canStart
          ? "Bắt đầu ván mới"
          : "Cần ít nhất 2 người"
        : "Chờ chủ phòng bắt đầu";
    } else {
      startBtn.classList.remove("hidden");
      waitingEl.classList.add("hidden");
      startBtn.disabled = !(isHost && state.canStart);
      startBtn.textContent = isHost
        ? state.canStart
          ? "Bắt đầu"
          : `Cần ít nhất 2 người`
        : "Chờ chủ phòng bắt đầu";
    }

    if (slotElements.length === 0) renderHexagonSlots();

    state.slots.forEach((player, i) => {
      const el = slotElements[i];
      if (!el) return;
      el.classList.remove("spotlight", "eliminated-flash", "spectator");
      el.innerHTML = avatarHtmlFor(player, i, true);

      if (player) {
        const nameDiv = document.createElement("div");
        nameDiv.className = "slot-name";
        nameDiv.textContent = player.name;
        el.appendChild(nameDiv);

        if (isHost && player.id !== myId && state.lobbyPhase !== "playing") {
          const kickBtn = document.createElement("button");
          kickBtn.className = "slot-kick-btn";
          kickBtn.textContent = "✕";
          kickBtn.type = "button";
          kickBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            socket.emit("room:kick", { targetId: player.id });
          });
          el.querySelector(".slot-avatar-wrap").appendChild(kickBtn);
        }
        el.onclick = null;
      } else {
        el.onclick = () => {
          if (state.lobbyPhase === "playing") return;
          const mySlot = state.slots.findIndex((p) => p && p.id === myId);
          if (mySlot === i) return;
          socket.emit("room:move", { targetSlot: i });
        };
      }
    });
  }

  let waitingInterval = null;
  function startWaitingCountdown() {
    if (waitingInterval) clearInterval(waitingInterval);
    const waitingEl = document.getElementById("waitingNextGame");
    function tick() {
      if (!lastLobbyState || lastLobbyState.lobbyPhase !== "ended_waiting") {
        clearInterval(waitingInterval);
        return;
      }
      // server không gửi nextGameAvailableAt trực tiếp qua lobby state hiện tại;
      // hiển thị thông báo tĩnh, vì thời điểm chính xác không thiết yếu để chơi tiếp.
      waitingEl.textContent = "Chủ phòng có thể bấm \"Bắt đầu ván mới\" ngay, hoặc phòng sẽ tự về sảnh chờ sau ít phút nếu không ai bấm.";
    }
    tick();
    waitingInterval = setInterval(tick, 5000);
  }

  document.getElementById("btnTogglePublic").addEventListener("click", () => {
    const newVal = !(lastLobbyState && lastLobbyState.isPublic);
    socket.emit("room:setPublic", { isPublic: newVal });
  });

  document.getElementById("btnStartGame").addEventListener("click", () => {
    socket.emit("room:start", (res) => {
      if (!res.ok) {
        const msg = res.reason === "not_host" ? "Chỉ chủ phòng mới được bắt đầu." : "Chưa đủ điều kiện bắt đầu.";
        toast(msg, "danger");
      }
    });
  });

  socket.on("lobby:update", (state) => {
    if (state.code !== currentRoomCode) return;
    renderLobby(state);
  });

  document.getElementById("btnLeaveRoom").addEventListener("click", () => {
    socket.emit("room:leave");
    resetRoomClientState();
    showScreen("home");
  });

  function resetRoomClientState() {
    currentRoomCode = null;
    lastLobbyState = null;
    lastGameState = null;
    isHost = false;
    selectedSwapCell = null;
    slotElements = [];
    if (turnCountdownInterval) clearInterval(turnCountdownInterval);
    if (swapCountdownInterval) clearInterval(swapCountdownInterval);
    if (waitingInterval) clearInterval(waitingInterval);
    document.getElementById("chatMessages").innerHTML = "";
    document.getElementById("turnInputBar").classList.add("hidden");
    document.getElementById("swapModal").classList.add("hidden");
    document.body.classList.remove("turn-active-mobile");
    hexagonArena.classList.remove("dimmed");
  }

  socket.on("room:kicked", () => {
    toast("Bạn đã bị đuổi khỏi phòng.", "danger");
    resetRoomClientState();
    showScreen("home");
  });

  // ============ GAME RENDERING ============
  function showAnnouncement(text, ms) {
    const el = document.getElementById("centerAnnouncement");
    el.textContent = text;
    el.classList.remove("show");
    // restart animation
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(el._hideTimeout);
    el._hideTimeout = setTimeout(() => el.classList.remove("show"), ms || 2500);
  }

  function renderGame(state) {
    lastGameState = state;
    hexagonArena.classList.add("dimmed");
    document.getElementById("btnStartGame").classList.add("hidden");

    if (!lastLobbyState) return;

    lastLobbyState.slots.forEach((player, i) => {
      const el = slotElements[i];
      if (!el || !player) return;
      el.classList.remove("spotlight", "spectator");
      if (state.spectators.includes(player.id)) {
        el.classList.add("spectator");
      }
      if (state.phase === "counting" && state.currentPlayerId === player.id) {
        el.classList.add("spotlight");
      }
      // badge giữ thẻ "1"
      const wrap = el.querySelector(".slot-avatar-wrap");
      if (wrap) {
        const existingBadge = wrap.querySelector(".slot-holder-badge");
        if (existingBadge) existingBadge.remove();
        if (state.holderId === player.id) {
          const badge = document.createElement("div");
          badge.className = "slot-holder-badge";
          badge.textContent = "1";
          wrap.appendChild(badge);
        }
      }
    });

    updateTurnBar(state);
    updateSwapModal(state);
  }

  function updateTurnBar(state) {
    const bar = document.getElementById("turnInputBar");
    if (state.phase === "counting" && state.currentPlayerId === myId) {
      bar.classList.remove("hidden");
      document.body.classList.add("turn-active-mobile");
      const input = document.getElementById("turnInput");
      input.value = "";
      input.focus();
      startTurnCountdown(state);
    } else {
      bar.classList.add("hidden");
      document.body.classList.remove("turn-active-mobile");
      if (turnCountdownInterval) clearInterval(turnCountdownInterval);
    }
  }

  function startTurnCountdown(state) {
    if (turnCountdownInterval) clearInterval(turnCountdownInterval);
    const textEl = document.getElementById("turnTimerText");
    function tick() {
      const elapsed = (Date.now() - state.turnStartedAt) / 1000;
      const remain = Math.max(0, Math.ceil(state.turnDuration - elapsed));
      textEl.textContent = remain;
      if (remain <= 0) clearInterval(turnCountdownInterval);
    }
    tick();
    turnCountdownInterval = setInterval(tick, 200);
  }

  function updateSwapModal(state) {
    const modal = document.getElementById("swapModal");
    if (state.phase === "swapping" && state.pendingSwapBy === myId) {
      modal.classList.remove("hidden");
      renderSwapGrid(state);
      startSwapCountdown(state);
    } else {
      modal.classList.add("hidden");
      if (swapCountdownInterval) clearInterval(swapCountdownInterval);
      selectedSwapCell = null;
    }
  }

  function renderSwapGrid(state) {
    const grid = document.getElementById("swapCellsGrid");
    grid.innerHTML = "";
    const totalSwapped = state.cells.filter((c) => c.swapped).length;

    state.cells.forEach((cell, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "swap-cell-btn" + (cell.swapped ? " swapped" : "");
      btn.textContent = cell.value;
      btn.title = cell.swapped ? `Ô #${idx + 1} (đã đổi)` : `Ô #${idx + 1}`;

      // Disable nếu chưa đủ điều kiện đổi lại (đã đổi rồi nhưng chưa đủ 15 ô / chưa đủ 15 lượt)
      let disabled = false;
      if (cell.swapped && totalSwapped < 15) disabled = true;
      // server sẽ kiểm tra chi tiết swapsSince, client chỉ chặn điều kiện rõ ràng nhất để UX tốt hơn,
      // còn lại để server validate và trả lỗi cụ thể.

      if (disabled) btn.disabled = true;
      if (selectedSwapCell === idx) btn.classList.add("selected");

      btn.addEventListener("click", () => {
        selectedSwapCell = idx;
        renderSwapGrid(state);
      });
      grid.appendChild(btn);
    });
  }

  function startSwapCountdown(state) {
    if (swapCountdownInterval) clearInterval(swapCountdownInterval);
    const textEl = document.getElementById("swapTimerText");
    function tick() {
      const elapsed = (Date.now() - state.turnStartedAt) / 1000;
      const remain = Math.max(0, Math.ceil(state.turnDuration - elapsed));
      textEl.textContent = remain + "s";
      if (remain <= 0) clearInterval(swapCountdownInterval);
    }
    tick();
    swapCountdownInterval = setInterval(tick, 200);
  }

  document.getElementById("btnSwapSubmit").addEventListener("click", () => {
    const errorEl = document.getElementById("swapError");
    errorEl.textContent = "";
    if (selectedSwapCell === null) {
      errorEl.textContent = "Hãy chọn 1 ô để đổi.";
      return;
    }
    const word = document.getElementById("swapWordInput").value.trim();
    if (!word) {
      errorEl.textContent = "Hãy nhập từ mới.";
      return;
    }
    socket.emit("game:submitSwap", { cellIndex: selectedSwapCell, newWord: word }, (res) => {
      if (!res.ok) {
        const reasonMap = {
          half_not_reached: "Cần ít nhất 15 ô đã đổi mới được đổi lại ô này.",
          too_soon_to_reswap: "Chưa đủ 15 lượt đổi để đổi lại ô này.",
          cannot_revert_to_original: "Không thể đổi về giá trị gốc.",
          same_as_current: "Từ mới phải khác giá trị hiện tại.",
          duplicate_value: "Từ này đã được dùng ở ô khác.",
          invalid_word_length: "Từ phải có 1-10 ký tự.",
        };
        errorEl.textContent = reasonMap[res.reason] || "Không thể đổi, thử lại.";
        return;
      }
      document.getElementById("swapWordInput").value = "";
      selectedSwapCell = null;
    });
  });

  document.getElementById("swapWordInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btnSwapSubmit").click();
  });

  // ============ Turn input submit ============
  function submitTurnValue() {
    const input = document.getElementById("turnInput");
    const value = input.value.trim();
    if (!value) return;
    socket.emit("game:submitNumber", { value });
    input.value = "";
  }
  document.getElementById("btnTurnSubmit").addEventListener("click", submitTurnValue);
  document.getElementById("turnInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitTurnValue();
  });

  // ============ Game socket events ============
  socket.on("game:started", () => {
    hexagonArena.classList.add("dimmed");
  });

  socket.on("game:update", (state) => {
    if (!currentRoomCode) return;
    renderGame(state);
  });

  socket.on("game:correct", (data) => {
    showAnnouncement(`✓ ${data.value}`, 1000);
  });

  socket.on("game:eliminated", (data) => {
    const name = playerNameById(data.playerId);
    const reasonText = data.reason === "timeout" ? "hết giờ" : `nhập sai (đúng phải là "${data.expectedValue}")`;
    toast(`${name} bị loại — ${reasonText}`, "danger");
    flashEliminated(data.playerId);
  });

  socket.on("game:roundComplete", (data) => {
    const name = playerNameById(data.swapperId);
    showAnnouncement(`🎉 ${name} hoàn thành vòng 30! Đang chọn từ để đổi...`, 3000);
  });

  socket.on("game:swapped", (data) => {
    showAnnouncement(`"${data.oldValue}" đã thay đổi thành "${data.newValue}"`, 3000);
  });

  socket.on("game:swapSkipped", () => {
    showAnnouncement("Hết giờ đổi từ — bỏ qua.", 2000);
  });

  socket.on("game:over", (data) => {
    hexagonArena.classList.remove("dimmed");
    const name = data.winnerId ? playerNameById(data.winnerId) : "Không ai";
    showAnnouncement(`🏆 ${name} đã thắng!`, 4000);
    toast(`${name} đã thắng ván này!`, "success");
  });

  function flashEliminated(playerId) {
    if (!lastLobbyState) return;
    const slot = lastLobbyState.slots.findIndex((p) => p && p.id === playerId);
    if (slot === -1) return;
    const el = slotElements[slot];
    el.classList.add("eliminated-flash");
    setTimeout(() => el.classList.remove("eliminated-flash"), 900);
  }

  function playerNameById(id) {
    if (!lastLobbyState) return "Ai đó";
    const p = lastLobbyState.slots.find((p) => p && p.id === id);
    return p ? p.name : "Ai đó";
  }

  // ============ Chat ============
  const chatMessages = document.getElementById("chatMessages");

  function appendChatMessage(msg, isSystem) {
    const div = document.createElement("div");
    div.className = "chat-msg" + (isSystem ? " system" : "");
    if (!isSystem) {
      const nameSpan = document.createElement("span");
      nameSpan.className = "chat-name";
      nameSpan.textContent = msg.name + ":";
      div.appendChild(nameSpan);
    }
    const textSpan = document.createElement("span");
    textSpan.className = "chat-text";
    textSpan.textContent = msg.text;
    div.appendChild(textSpan);
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  socket.on("chat:message", (msg) => {
    appendChatMessage(msg, false);
  });

  socket.on("chat:blocked", () => {
    toast("Tin nhắn của bạn trùng với một từ đã đổi, không thể gửi.", "danger");
  });

  function sendChat() {
    const input = document.getElementById("chatInput");
    const text = input.value.trim();
    if (!text) return;

    // Nếu đang tới lượt mình trong game, ưu tiên coi đây là nhập số/từ của lượt
    if (
      lastGameState &&
      lastGameState.phase === "counting" &&
      lastGameState.currentPlayerId === myId
    ) {
      socket.emit("game:submitNumber", { value: text });
      input.value = "";
      return;
    }

    socket.emit("chat:send", { text });
    input.value = "";
  }
  document.getElementById("btnChatSend").addEventListener("click", sendChat);
  document.getElementById("chatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChat();
  });

  // ============ Resize handling ============
  function reRenderArenaIfActive() {
    if (screens.room.classList.contains("active")) {
      renderHexagonSlots();
      if (lastLobbyState) renderLobby(lastLobbyState);
      if (lastGameState) renderGame(lastGameState);
    }
  }
  let resizeDebounce = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(reRenderArenaIfActive, 120);
  });
  // Xoay màn hình điện thoại: kích thước viewport thay đổi sau một nhịp ngắn,
  // nên chờ chút trước khi tính lại vị trí lục giác.
  window.addEventListener("orientationchange", () => {
    setTimeout(reRenderArenaIfActive, 250);
  });

  // Render slots ngay khi vào phòng lần đầu (đảm bảo arena đã có kích thước)
  const roomObserver = new MutationObserver(() => {
    if (screens.room.classList.contains("active") && slotElements.length === 0) {
      renderHexagonSlots();
      if (lastLobbyState) renderLobby(lastLobbyState);
    }
  });
  roomObserver.observe(screens.room, { attributes: true, attributeFilter: ["class"] });
})();
