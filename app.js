/* ===========================================================
   Простой блог без бэкенда. Данные лежат в posts.json в репо.
   Публикация постов идёт напрямую из браузера через GitHub API
   (Contents API), поэтому "сервер" не нужен вообще.
   =========================================================== */

const POSTS_FILE = "posts.json";
const UPLOADS_DIR = "uploads";
const CFG_KEY = "editor_gh_config"; // { token, owner, repo, branch }

const app = document.getElementById("app");
let CURRENT_POSTS = null; // кэш последнего чтения posts.json (для списка/чтения)

/* ---------------- УТИЛИТЫ ---------------- */

function pad6(n) {
  return String(n).padStart(6, "0");
}

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return iso;
  }
}

function excerpt(md, len = 160) {
  const plain = md
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/[#>*`_-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > len ? plain.slice(0, len) + "…" : plain;
}

async function loadPosts(forceFresh = false) {
  const url = forceFresh ? `${POSTS_FILE}?_=${Date.now()}` : POSTS_FILE;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Не удалось загрузить posts.json");
  const data = await res.json();
  CURRENT_POSTS = Array.isArray(data) ? data : [];
  return CURRENT_POSTS;
}

function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(CFG_KEY) || "null");
  } catch (e) {
    return null;
  }
}

function setConfig(cfg) {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

function isEditor() {
  return !!getConfig();
}

/* ---------------- РОУТИНГ ---------------- */

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", () => {
  render();
  setupSecretLogoTrigger();
});

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  if (!hash) return { name: "home" };
  if (/^\d{6}$/.test(hash)) return { name: "post", id: hash };
  return { name: "home" };
}

async function render() {
  const route = currentRoute();
  try {
    await loadPosts();
  } catch (e) {
    app.innerHTML = `<div class="empty-state">Не получилось загрузить посты (${e.message}).</div>`;
    return;
  }
  if (route.name === "post") {
    renderPost(route.id);
  } else {
    renderHome();
  }
  renderEditorFab();
}

function renderHome() {
  if (!CURRENT_POSTS.length) {
    app.innerHTML = `<div class="empty-state">Постов пока нет. ${isEditor() ? "Нажми на кнопку внизу, чтобы написать первый." : ""}</div>`;
    return;
  }
  const sorted = [...CURRENT_POSTS].sort((a, b) => new Date(b.date) - new Date(a.date));
  app.innerHTML = sorted.map(p => `
    <a class="post-card" href="#/${p.id}">
      <h2>${escapeHtml(p.title)}</h2>
      <div class="meta">#${p.id} · ${fmtDate(p.date)}</div>
      <div class="excerpt">${escapeHtml(excerpt(p.content))}</div>
    </a>
  `).join("");
}

function renderPost(id) {
  const post = CURRENT_POSTS.find(p => p.id === id);
  if (!post) {
    app.innerHTML = `<div class="empty-state">Пост #${id} не найден.<br><a class="back-link" href="#/">&larr; На главную</a></div>`;
    return;
  }
  const html = window.marked ? window.marked.parse(post.content) : escapeHtml(post.content);
  app.innerHTML = `
    <a class="back-link" href="#/">&larr; Все посты</a>
    <article class="post-full">
      <h1>${escapeHtml(post.title)}</h1>
      <div class="meta">#${post.id} · ${fmtDate(post.date)}</div>
      ${html}
    </article>
  `;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

/* ---------------- СЕКРЕТНЫЙ ВХОД В РЕДАКТОР ---------------- */
/* 3 клика по логотипу в подвале за 1 секунду открывают панель редактора */

function setupSecretLogoTrigger() {
  const logo = document.getElementById("footer-logo");
  if (!logo) return;
  let clicks = [];
  logo.addEventListener("click", () => {
    const now = Date.now();
    clicks.push(now);
    clicks = clicks.filter(t => now - t <= 1000);
    if (clicks.length >= 3) {
      clicks = [];
      openEditorEntry();
    }
  });
}

function openEditorEntry() {
  if (isEditor()) {
    openPostEditor();
  } else {
    openLoginModal();
  }
}

/* ---------------- НАСТРОЙКА ДОСТУПА РЕДАКТОРА ---------------- */

function openLoginModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <h3>Вход для редактора</h3>
      <div class="field">
        <label>Владелец репозитория (username)</label>
        <input type="text" id="cfg-owner" placeholder="например, ivanov">
      </div>
      <div class="field">
        <label>Название репозитория</label>
        <input type="text" id="cfg-repo" placeholder="например, group-blog">
      </div>
      <div class="field">
        <label>Ветка</label>
        <input type="text" id="cfg-branch" value="main">
      </div>
      <div class="field">
        <label>GitHub token (fine-grained, доступ только к этому репо, Contents: Read and write)</label>
        <input type="password" id="cfg-token" placeholder="github_pat_...">
        <div class="hint">Создаётся в GitHub → Settings → Developer settings → Fine-grained tokens. Хранится только в этом браузере.</div>
      </div>
      <div class="status-line" id="login-status"></div>
      <div class="modal-actions">
        <button class="btn secondary" id="cfg-cancel">Отмена</button>
        <button class="btn" id="cfg-save">Сохранить</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const existing = getConfig();
  if (existing) {
    overlay.querySelector("#cfg-owner").value = existing.owner || "";
    overlay.querySelector("#cfg-repo").value = existing.repo || "";
    overlay.querySelector("#cfg-branch").value = existing.branch || "main";
  }

  overlay.querySelector("#cfg-cancel").onclick = () => overlay.remove();
  overlay.querySelector("#cfg-save").onclick = async () => {
    const owner = overlay.querySelector("#cfg-owner").value.trim();
    const repo = overlay.querySelector("#cfg-repo").value.trim();
    const branch = overlay.querySelector("#cfg-branch").value.trim() || "main";
    const token = overlay.querySelector("#cfg-token").value.trim();
    const statusEl = overlay.querySelector("#login-status");
    if (!owner || !repo || !token) {
      statusEl.textContent = "Заполни владельца, репозиторий и токен.";
      statusEl.className = "status-line error";
      return;
    }
    statusEl.textContent = "Проверяю доступ...";
    statusEl.className = "status-line";
    const ok = await testAccess({ owner, repo, branch, token });
    if (!ok) {
      statusEl.textContent = "Не получилось получить доступ. Проверь владельца/репозиторий/токен и права токена.";
      statusEl.className = "status-line error";
      return;
    }
    setConfig({ owner, repo, branch, token });
    overlay.remove();
    openPostEditor();
    renderEditorFab();
  };
}

async function testAccess(cfg) {
  try {
    const res = await ghRequest(cfg, `contents/${POSTS_FILE}`, { method: "GET" });
    return res.status === 200 || res.status === 404; // 404 ок, если файла ещё нет
  } catch (e) {
    return false;
  }
}

function ghRequest(cfg, path, opts = {}) {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/${path}`;
  return fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
      ...(opts.headers || {})
    }
  });
}

/* ---------------- ПЛАВАЮЩАЯ КНОПКА "НАПИСАТЬ ПОСТ" (видна только редактору) ---------------- */

function renderEditorFab() {
  let fab = document.getElementById("editor-fab");
  if (fab) fab.remove();
  if (!isEditor()) return;
  fab = document.createElement("div");
  fab.id = "editor-fab";
  fab.className = "editor-fab";
  fab.innerHTML = `<button class="btn" id="fab-write">+ Написать пост</button>`;
  document.body.appendChild(fab);
  fab.querySelector("#fab-write").onclick = openPostEditor;
}

/* ---------------- РЕДАКТОР ПОСТА (markdown) ---------------- */

async function openPostEditor() {
  const cfg = getConfig();
  if (!cfg) return openLoginModal();

  // получаем актуальный posts.json + sha, чтобы знать следующий id и суметь закоммитить
  let sha = null;
  let posts = [];
  try {
    const res = await ghRequest(cfg, `contents/${POSTS_FILE}`);
    if (res.status === 200) {
      const data = await res.json();
      sha = data.sha;
      posts = JSON.parse(decodeURIComponent(escape(atob(data.content))));
    } else if (res.status !== 404) {
      throw new Error("Ошибка чтения posts.json: " + res.status);
    }
  } catch (e) {
    alert("Не получилось прочитать posts.json: " + e.message);
    return;
  }

  const nextId = pad6((posts.reduce((max, p) => Math.max(max, parseInt(p.id, 10) || 0), 0)) + 1);
  let imgCounter = 0;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" style="max-width:760px;">
      <h3>Новый пост · #${nextId}</h3>
      <div class="field">
        <label>Заголовок</label>
        <input type="text" id="md-title" placeholder="Название поста">
      </div>
      <div class="field">
        <label>Содержание (Markdown)</label>
        <div class="editor-toolbar">
          <button type="button" data-wrap="**">Жирный</button>
          <button type="button" data-wrap="*">Курсив</button>
          <button type="button" data-prefix="## ">Заголовок</button>
          <button type="button" data-prefix="- ">Список</button>
          <button type="button" id="tb-link">Ссылка</button>
          <button type="button" id="tb-image">🖼 Изображение</button>
        </div>
        <textarea id="md-content" placeholder="Пиши текст здесь. Курсор в тексте — это место, куда встанет картинка, если нажать «Изображение»."></textarea>
        <input type="file" id="img-input" accept="image/*" style="display:none">
      </div>
      <div class="status-line" id="editor-status"></div>
      <div class="modal-actions">
        <button class="btn secondary" id="ed-logout">Выйти из редактора</button>
        <button class="btn secondary" id="ed-cancel">Отмена</button>
        <button class="btn" id="ed-publish">Опубликовать</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const textarea = overlay.querySelector("#md-content");
  const statusEl = overlay.querySelector("#editor-status");

  overlay.querySelector("#ed-cancel").onclick = () => overlay.remove();
  overlay.querySelector("#ed-logout").onclick = () => {
    if (confirm("Выйти из режима редактора на этом устройстве?")) {
      localStorage.removeItem(CFG_KEY);
      overlay.remove();
      renderEditorFab();
    }
  };

  // тулбар: обёртка выделенного текста (жирный/курсив)
  overlay.querySelectorAll("[data-wrap]").forEach(btn => {
    btn.onclick = () => {
      const mark = btn.dataset.wrap;
      wrapSelection(textarea, mark, mark);
    };
  });
  // тулбар: префикс строки (заголовок/список)
  overlay.querySelectorAll("[data-prefix]").forEach(btn => {
    btn.onclick = () => insertAtCursor(textarea, btn.dataset.prefix);
  });
  overlay.querySelector("#tb-link").onclick = () => {
    const text = prompt("Текст ссылки:", "текст") || "текст";
    const url = prompt("URL:", "https://") || "";
    insertAtCursor(textarea, `[${text}](${url})`);
  };

  // вставка изображения ИМЕННО в месте курсора
  const imgInput = overlay.querySelector("#img-input");
  overlay.querySelector("#tb-image").onclick = () => imgInput.click();
  imgInput.onchange = async () => {
    const file = imgInput.files[0];
    if (!file) return;
    imgInput.value = "";
    statusEl.textContent = "Загружаю изображение...";
    statusEl.className = "status-line";
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      imgCounter += 1;
      const path = `${UPLOADS_DIR}/${nextId}-${imgCounter}.${ext}`;
      const base64 = await fileToBase64(file);
      const putRes = await ghRequest(cfg, `contents/${path}`, {
        method: "PUT",
        body: JSON.stringify({
          message: `upload image for post #${nextId}`,
          content: base64,
          branch: cfg.branch
        })
      });
      if (!putRes.ok) throw new Error("GitHub API: " + putRes.status);
      insertAtCursor(textarea, `\n![изображение](${path})\n`);
      statusEl.textContent = "Изображение вставлено.";
      statusEl.className = "status-line ok";
    } catch (e) {
      statusEl.textContent = "Не получилось загрузить изображение: " + e.message;
      statusEl.className = "status-line error";
    }
  };

  overlay.querySelector("#ed-publish").onclick = async () => {
    const title = overlay.querySelector("#md-title").value.trim();
    const content = textarea.value.trim();
    if (!title || !content) {
      statusEl.textContent = "Заполни заголовок и текст поста.";
      statusEl.className = "status-line error";
      return;
    }
    statusEl.textContent = "Публикую...";
    statusEl.className = "status-line";
    try {
      const newPost = { id: nextId, title, date: new Date().toISOString(), content };
      const updated = [newPost, ...posts];
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(updated, null, 2))));
      const body = {
        message: `new post #${nextId}: ${title}`,
        content: encoded,
        branch: cfg.branch
      };
      if (sha) body.sha = sha;
      const putRes = await ghRequest(cfg, `contents/${POSTS_FILE}`, {
        method: "PUT",
        body: JSON.stringify(body)
      });
      if (!putRes.ok) {
        const errData = await putRes.json().catch(() => ({}));
        throw new Error(errData.message || String(putRes.status));
      }
      statusEl.textContent = "Опубликовано! Сайт обновится в течение минуты.";
      statusEl.className = "status-line ok";
      setTimeout(() => {
        overlay.remove();
        location.hash = `#/${nextId}`;
      }, 900);
    } catch (e) {
      statusEl.textContent = "Ошибка публикации: " + e.message;
      statusEl.className = "status-line error";
    }
  };
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  textarea.value = value.slice(0, start) + text + value.slice(end);
  const pos = start + text.length;
  textarea.focus();
  textarea.setSelectionRange(pos, pos);
}

function wrapSelection(textarea, before, after) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.slice(start, end) || "текст";
  const replacement = before + selected + after;
  textarea.value = value.slice(0, start) + replacement + value.slice(end);
  textarea.focus();
  textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
