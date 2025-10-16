import TVNavigation from "./navigation.js";
import M3UParser from "./m3u-parser.js";

const REMOTE_PLAYLIST_URL = "https://cdn.jsdelivr.net/gh/Zzprog-arg/sdad@main/playlist.m3u";
const PLAYLIST_IDB_KEY = "playlist-local";

class NetflisApp {
  constructor() {
    this.navigation = new TVNavigation();
    this.parser = new M3UParser();
    this.allCategories = [];
    this.currentCategory = null;
    this.currentContentType = "tv";
    this.isLoggedIn = false;
    this.username = "";
    this.init();
  }

  init() {
    this.cacheEls();
    this.bindUI();
    this.showSplashThenStart();
    this.setupGlobalBackHandler();
  }

  cacheEls() {
    this.screens = {
      splash: document.getElementById("splash-screen"),
      login: document.getElementById("login-screen"),
      upload: document.getElementById("upload-screen"),
      contentType: document.getElementById("content-type-screen"),
      categories: document.getElementById("categories-screen"),
      movies: document.getElementById("movies-screen"),
      episodes: document.getElementById("episodes-screen"),
      player: document.getElementById("player-screen"),
    };
    this.loadingEl = document.getElementById("loading");
    this.loginForm = document.getElementById("login-form");
    this.usernameInput = document.getElementById("username");
    this.passwordInput = document.getElementById("password");
    this.loginError = document.getElementById("login-error");
    this.uploadStatus = document.getElementById("upload-status");
    this.updateBtn = document.getElementById("update-playlist-btn");
    this.userProfileBtn = document.getElementById("user-profile-btn");
    this.video = document.getElementById("video-player");
  }

  bindUI() {
    if (this.loginForm) {
      this.loginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.handleLogin();
      });
    }
    if (this.updateBtn) {
      this.updateBtn.addEventListener("click", () => this.forceUpdatePlaylist());
      this.updateBtn.style.display = "none";
    }
    if (this.userProfileBtn) {
      this.userProfileBtn.addEventListener("click", () => this.showUserProfile());
    }
    // back from player close button
    const closeBtn = document.getElementById("close-player");
    if (closeBtn) closeBtn.addEventListener("click", () => this.closePlayer());
  }

  showSplashThenStart() {
    setTimeout(() => {
      const savedLogin = localStorage.getItem("netflis_logged_in");
      const savedUsername = localStorage.getItem("netflis_username");
      if (savedLogin === "true" && savedUsername) {
        this.isLoggedIn = true;
        this.username = savedUsername;
        this.updateUserDisplay();
        this.loadPlaylistFromBackend(); // auto
      } else {
        this.showScreen("login");
      }
    }, 1000);
  }

  showScreen(name) {
    Object.values(this.screens).forEach((el) => el && el.classList.remove("active"));
    const el = this.screens[name];
    if (el) el.classList.add("active");
  }

  // ---------------- IndexedDB helpers ----------------
  openIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("playlist-db", 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async idbPut(key, value) {
    const db = await this.openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(value, key);
      tx.oncomplete = () => res();
      tx.onerror = (e) => rej(e.target.error);
    });
  }

  async idbGet(key) {
    const db = await this.openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction("files", "readonly");
      const req = tx.objectStore("files").get(key);
      req.onsuccess = () => res(req.result);
      req.onerror = (e) => rej(e.target.error);
    });
  }

  async idbDelete(key) {
    const db = await this.openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").delete(key);
      tx.oncomplete = () => res();
      tx.onerror = (e) => rej(e.target.error);
    });
  }
  // ---------------------------------------------------

  async handleLogin() {
    const u = this.usernameInput.value.trim();
    const p = this.passwordInput.value.trim();

    // Simple demo auth — replace if needed
    if (u === "miuser" && p === "mipass") {
      this.isLoggedIn = true;
      this.username = u;
      localStorage.setItem("netflis_logged_in", "true");
      localStorage.setItem("netflis_username", u);
      this.updateUserDisplay();
      this.loadPlaylistFromBackend();
    } else {
      this.loginError.textContent = "Usuario o contraseña incorrectos";
      this.passwordInput.value = "";
    }
  }

  updateUserDisplay() {
    if (this.userProfileBtn) this.userProfileBtn.textContent = this.username || "Usuario";
  }

  showLoading(show) {
    if (!this.loadingEl) return;
    this.loadingEl.classList.toggle("active", !!show);
  }

  // ---------------- Playlist load flow ----------------
  async loadPlaylistFromIndexedDB() {
    try {
      return await this.idbGet(PLAYLIST_IDB_KEY);
    } catch (e) {
      console.warn("idb get error", e);
      return null;
    }
  }

  async downloadPlaylistToIndexedDB(remoteUrl = REMOTE_PLAYLIST_URL) {
    this.showLoading(true);
    try {
      const res = await fetch(remoteUrl);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      await this.idbPut(PLAYLIST_IDB_KEY, text);
      console.log("Saved playlist, chars:", text.length);
      return text;
    } finally {
      this.showLoading(false);
    }
  }

  async clearLocalPlaylist() {
    try {
      await this.idbDelete(PLAYLIST_IDB_KEY);
      console.log("Cleared playlist");
    } catch (e) {
      console.warn(e);
    }
  }

  async loadPlaylistFromBackend() {
    this.showLoading(true);
    try {
      // 1. local
      const local = await this.loadPlaylistFromIndexedDB();
      if (local) {
        this.allCategories = this.parser.parse(local);
        if (this.allCategories && this.allCategories.length) {
          this.showContentTypeScreen();
          return;
        }
      }

      // 2. embedded file (if packaged)
      try {
        const r = await fetch("./playlist.txt");
        if (r.ok) {
          const txt = await r.text();
          this.allCategories = this.parser.parse(txt);
          if (this.allCategories && this.allCategories.length) {
            this.showContentTypeScreen();
            return;
          }
        }
      } catch (e) { /* ignore */ }

      // 3. download remote and save
      const remoteText = await this.downloadPlaylistToIndexedDB(REMOTE_PLAYLIST_URL);
      this.allCategories = this.parser.parse(remoteText);
      if (this.allCategories && this.allCategories.length) {
        this.showContentTypeScreen();
        return;
      }

      throw new Error("No categories found after loading");
    } catch (e) {
      console.error("Load playlist failed", e);
      alert("No se pudo cargar la playlist. Revisa REMOTE_PLAYLIST_URL o empaqueta playlist.txt");
      this.showScreen("upload");
    } finally {
      this.showLoading(false);
    }
  }

  async forceUpdatePlaylist() {
    if (!this.isLoggedIn) {
      alert("Debes iniciar sesión para actualizar la lista.");
      return;
    }
    const ok = confirm("¿Deseas actualizar la lista ahora? Se eliminará la copia local y se descargará la nueva versión.");
    if (!ok) return;
    this.showLoading(true);
    try {
      await this.clearLocalPlaylist();
      const txt = await this.downloadPlaylistToIndexedDB(REMOTE_PLAYLIST_URL);
      this.allCategories = this.parser.parse(txt);
      if (this.allCategories && this.allCategories.length) {
        this.showContentTypeScreen();
        this.uploadStatus && (this.uploadStatus.textContent = "Lista actualizada.");
      }
    } catch (e) {
      console.error(e);
      alert("Error actualizando playlist: " + (e.message || e));
    } finally {
      this.showLoading(false);
    }
  }

  // ---------------- UI screens ----------------
  showContentTypeScreen() {
    this.showScreen("contentType");
    // enable update button
    if (this.updateBtn) this.updateBtn.style.display = "inline-block";
    this.updateUserDisplay();
    // small counts preview
    const tvc = document.getElementById("tv-count");
    const mvc = document.getElementById("movies-count");
    const sc = document.getElementById("series-count");
    const counts = this.calculateContentTypeCounts();
    if (tvc) tvc.textContent = `${counts.tv} canales`;
    if (mvc) mvc.textContent = `${counts.movies} películas`;
    if (sc) sc.textContent = `${counts.series} series`;
    // wire cards
    const cards = document.querySelectorAll(".content-type-card");
    cards.forEach((card) => {
      card.onclick = () => {
        const type = card.getAttribute("data-type");
        this.selectContentType(type);
      };
    });
  }

  calculateContentTypeCounts() {
    const counts = { tv: 0, movies: 0, series: 0 };
    (this.allCategories || []).forEach((c) => {
      (c.movies || []).forEach((m) => {
        counts[m.contentType] = (counts[m.contentType] || 0) + 1;
      });
    });
    return counts;
  }

  selectContentType(type) {
    this.currentContentType = type;
    this.categories = (this.allCategories || []).map((category) => {
      const movies = (category.movies || []).filter((m) => m.contentType === type);
      if (!movies.length) return null;
      return { name: category.name, count: movies.length, movies };
    }).filter(Boolean);
    this.showCategoriesScreen();
  }

  showCategoriesScreen() {
    this.showScreen("categories");
    const container = document.getElementById("categories-container");
    const totalCategories = document.getElementById("total-categories");
    container.innerHTML = "";
    if (totalCategories) totalCategories.textContent = `${this.categories.length} categorías`;
    this.categories.forEach((cat) => {
      const card = document.createElement("div");
      card.className = "category-card";
      card.innerHTML = `
        <div class="category-backdrop"></div>
        <div class="category-content">
          <div class="category-icon">🎬</div>
          <div class="category-name">${cat.name}</div>
          <div class="category-count">${cat.count} items</div>
        </div>`;
      card.onclick = () => this.showMoviesScreen(cat);
      container.appendChild(card);
    });
  }

  showMoviesScreen(category) {
    this.currentCategory = category;
    this.showScreen("movies");
    document.getElementById("category-title").textContent = category.name;
    document.getElementById("total-movies").textContent = `${category.count} items`;
    const carousel = document.getElementById("movies-carousel");
    carousel.innerHTML = "";
    category.movies.forEach((m) => {
      const card = document.createElement("div");
      card.className = "movie-card";
      card.innerHTML = `<div class="movie-poster">${m.logo ? `<img src="${m.logo}">` : "📺"}</div>
        <div class="movie-info"><div class="movie-title">${m.title}</div><div class="movie-meta">${m.category || ""}</div></div>`;
      card.onclick = () => this.playMovie(m);
      carousel.appendChild(card);
    });
  }

  showEpisodesScreen(seriesName, episodes) {
    this.showScreen("episodes");
    document.getElementById("series-title").textContent = seriesName;
    document.getElementById("total-episodes").textContent = `${episodes.length} episodios disponibles`;
    const container = document.getElementById("episodes-container");
    container.innerHTML = "";
    episodes.forEach((ep) => {
      const card = document.createElement("div");
      card.className = "episode-card";
      card.innerHTML = `<div class="episode-poster">${ep.logo ? `<img src="${ep.logo}">` : "📺"}</div>
        <div class="episode-info"><div class="episode-number">T${ep.season} E${ep.episode}</div><div class="episode-title">${ep.episodeTitle || ep.title}</div></div>`;
      card.onclick = () => this.playMovie(ep);
      container.appendChild(card);
    });
  }

  // ---------------- Playback ----------------
  async playMovie(movie, startTime = 0) {
    this.showScreen("player");
    const video = this.video;
    const title = document.getElementById("player-title");
    const cat = document.getElementById("player-category");
    title.textContent = movie.episodeTitle || movie.title || "";
    cat.textContent = movie.category || "";
    video.src = movie.url;
    try {
      await video.load?.();
    } catch(e){/* ignore */}
    // try autoplay + fullscreen
    try {
      await video.play();
      try {
        if (video.requestFullscreen) video.requestFullscreen();
        else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen();
        else if (video.mozRequestFullScreen) video.mozRequestFullScreen();
        else if (video.msRequestFullscreen) video.msRequestFullscreen();
      } catch (fsErr) {
        console.debug("Fullscreen denied:", fsErr && fsErr.message);
        // Fallback: aplicar "CSS fullscreen" (clase) para simular fullscreen cuando requestFullscreen() está bloqueado
        try {
          this._cssFullscreen = true;
          document.documentElement.classList.add("css-fullscreen");
        } catch(e) { /* ignore */ }
      }
    } catch (playErr) {
      console.error("Play error", playErr);
      alert("Error al reproducir el video. Verifica la URL.");
    }
    if (startTime && video.duration) {
      try { video.currentTime = startTime; } catch(e){}
    }
  }

  async closePlayer() {
    // try exit fullscreen first
    await this.exitFullscreenIfNeeded().catch(()=>{});
    const video = this.video;
    // remove CSS fullscreen if it was used
    try { if (this._cssFullscreen) { document.documentElement.classList.remove('css-fullscreen'); this._cssFullscreen = false; } } catch(e){}
    try { video.pause(); } catch(e) {}
    try { video.removeAttribute('src'); video.load && video.load(); } catch(e){}
    // go back to episodes or movies depending
    if (this.currentContentType === "series" && this.currentSeries) {
      this.showEpisodesScreen(this.currentSeries.name, this.currentSeries.episodes);
    } else {
      this.showMoviesScreen(this.currentCategory);
    }
  }

  isInFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
  }

  async exitFullscreenIfNeeded() {
    try {
      if (this.isInFullscreen()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
        else if (document.mozCancelFullScreen) await document.mozCancelFullScreen();
        else if (document.msExitFullscreen) await document.msExitFullscreen();
        return true;
      }
    } catch(e) {
      console.debug("exit fullscreen error", e && e.message);
    }
    if (document.documentElement.classList.contains('css-fullscreen')) {
      document.documentElement.classList.remove('css-fullscreen');
      this._cssFullscreen = false;
      return true;
    }
    return false;
  }

  setupGlobalBackHandler() {
    window.addEventListener('keydown', async (e) => {
      const key = e.key;
      const code = e.keyCode || e.which;
      const isBackKey = (
        key === 'Back' ||
        key === 'Backspace' ||
        key === 'BrowserBack' ||
        key === 'SoftLeft' ||
        key === 'MediaBack' ||
        key === 'Escape' ||
        key === 'Delete' ||
        code === 4 ||
        code === 8 ||
        code === 27 ||
        code === 46 ||
        code === 10009
      );
      if (!isBackKey) return;
      const video = this.video;
      // if playing and fullscreen => exit fullscreen
      if (video && !video.paused && this.isInFullscreen()) {
        e.preventDefault();
        const exited = await this.exitFullscreenIfNeeded();
        if (exited) return;
      }
      // if playing but not fullscreen => stop player
      if (video && !video.paused) {
        e.preventDefault();
        this.closePlayer();
        return;
      }
      // default: app navigation back
      e.preventDefault();
      this.handleBack();
    }, {passive:false});
  }

  handleBack() {
    const current = this.navigation.currentScreen;
    switch (current) {
      case 'player':
        this.closePlayer();
        break;
      case 'episodes':
        this.showMoviesScreen(this.currentCategory);
        break;
      case 'movies':
        this.showCategoriesScreen();
        break;
      case 'categories':
        this.showContentTypeScreen();
        break;
      case 'content-type':
        // do nothing on main screen
        break;
      default:
        // show content type as fallback
        this.showContentTypeScreen();
        break;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.app = new NetflisApp();
});
