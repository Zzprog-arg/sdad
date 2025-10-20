// Aplicación principal estilo Netflix
import TVNavigation from "./navigation.js"
import M3UParser from "./m3u-parser.js"

const REMOTE_PLAYLIST_URL = "https://raw.githubusercontent.com/Zzprog-arg/sdad/refs/heads/main/playlist.m3u"
const PLAYLIST_IDB_KEY = "playlist-local"

class NetflisApp {
  constructor() {
    this.navigation = new TVNavigation()
    this.allCategories = []
    this.categories = []
    this.currentCategory = null
    this.currentContentType = null
    this.currentSeries = null
    this.isLoggedIn = false
    this.uploadScreenSetup = false
    this.categoryLogos = new Map()
    this.watchProgress = this.loadWatchProgress()
    this.username = ""
    this.currentSearchQuery = ""
    this.init()
    this.setupBackHandler()
    this.setupGlobalBackHandler()
  }

  init() {
    this.loadCategoryLogos()
    this.showSplashScreen()
  }

  openIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("playlist-db", 1)
      req.onupgradeneeded = (e) => {
        const db = e.target.result
        if (!db.objectStoreNames.contains("files")) {
          db.createObjectStore("files")
        }
      }
      req.onsuccess = (e) => resolve(e.target.result)
      req.onerror = (e) => reject(e.target.error)
    })
  }

  async idbPut(key, value) {
    const db = await this.openIDB()
    return new Promise((res, rej) => {
      const tx = db.transaction("files", "readwrite")
      tx.objectStore("files").put(value, key)
      tx.oncomplete = () => res()
      tx.onerror = (e) => rej(e.target.error)
    })
  }

  async idbGet(key) {
    const db = await this.openIDB()
    return new Promise((res, rej) => {
      const tx = db.transaction("files", "readonly")
      const req = tx.objectStore("files").get(key)
      req.onsuccess = () => res(req.result)
      req.onerror = (e) => rej(e.target.error)
    })
  }

  async idbDelete(key) {
    const db = await this.openIDB()
    return new Promise((res, rej) => {
      const tx = db.transaction("files", "readwrite")
      tx.objectStore("files").delete(key)
      tx.oncomplete = () => res()
      tx.onerror = (e) => rej(e.target.error)
    })
  }

  loadWatchProgress() {
    const saved = localStorage.getItem("netflis_watch_progress")
    return saved ? JSON.parse(saved) : {}
  }

  saveWatchProgress() {
    localStorage.setItem("netflis_watch_progress", JSON.stringify(this.watchProgress))
  }

  updateProgress(seriesName, season, episode, currentTime) {
    const key = `${seriesName}_S${season}E${episode}`
    this.watchProgress[key] = {
      seriesName,
      season,
      episode,
      currentTime,
      timestamp: Date.now(),
    }
    this.saveWatchProgress()
  }

  getLastWatched(seriesName) {
    const seriesProgress = Object.values(this.watchProgress)
      .filter((p) => p.seriesName === seriesName)
      .sort((a, b) => b.timestamp - a.timestamp)

    return seriesProgress[0] || null
  }

  async loadCategoryLogos() {
    try {
      const response = await fetch("./category-logos.json")
      if (response.ok) {
        const data = await response.json()
        data.categories.forEach((cat) => {
          this.categoryLogos.set(cat.name, cat.logo)
        })
      }
    } catch (error) {
      console.log("[v0] No se pudieron cargar los logos de categorías:", error)
    }
  }

  setupBackHandler() {
    window.addEventListener("navigation-back", () => {
      this.handleBack()
    })
  }

  showSplashScreen() {
    setTimeout(() => {
      const savedLogin = localStorage.getItem("netflis_logged_in")
      const savedUsername = localStorage.getItem("netflis_username")
      if (savedLogin === "true" && savedUsername) {
        this.isLoggedIn = true
        this.username = savedUsername
        this.loadPlaylistFromBackend()
      } else {
        this.showScreen("login")
        this.setupLoginScreen()
      }
    }, 2500)
  }

  async downloadPlaylistToIndexedDB(remoteUrl = REMOTE_PLAYLIST_URL) {
    this.showLoading(true)
    try {
      const resp = await fetch(remoteUrl)
      if (!resp.ok) throw new Error("Error HTTP " + resp.status)
      const text = await resp.text()
      await this.idbPut(PLAYLIST_IDB_KEY, text)
      console.log("Playlist guardada en IndexedDB (tamaño chars):", text.length)
      return text
    } finally {
      this.showLoading(false)
    }
  }

  async loadPlaylistFromIndexedDB() {
    try {
      const local = await this.idbGet(PLAYLIST_IDB_KEY)
      if (local) {
        console.log("Cargando playlist desde IndexedDB (local)")
        return local
      }
      return null
    } catch (e) {
      console.warn("Error leyendo IndexedDB:", e)
      return null
    }
  }

  async clearLocalPlaylist() {
    try {
      await this.idbDelete(PLAYLIST_IDB_KEY)
      console.log("Playlist local eliminada")
    } catch (e) {
      console.warn("No se pudo borrar playlist local", e)
    }
  }

  async loadPlaylistFromBackend() {
    this.showLoading(true)

    try {
      console.log("[v0] Intentando cargar desde URL remota:", REMOTE_PLAYLIST_URL)
      try {
        const remoteText = await this.downloadPlaylistToIndexedDB(REMOTE_PLAYLIST_URL)
        const parser = new M3UParser()
        this.allCategories = parser.parse(remoteText)
        if (this.allCategories.length === 0) {
          throw new Error("No se encontraron categorías en el archivo remoto")
        }
        console.log("[v0] Playlist cargada exitosamente desde URL remota")
        setTimeout(() => {
          this.showMainScreen()
        }, 500)
        return
      } catch (e) {
        console.warn("[v0] No se pudo descargar desde remoto, intentando cache local:", e)
      }

      const localText = await this.loadPlaylistFromIndexedDB()
      if (localText) {
        console.log("[v0] Usando playlist desde cache local (IndexedDB)")
        const parser = new M3UParser()
        this.allCategories = parser.parse(localText)

        if (this.allCategories.length === 0) {
          throw new Error("No se encontraron categorías en el cache local")
        }
        setTimeout(() => {
          this.showMainScreen()
        }, 500)
        return
      }

      try {
        console.log("[v0] Intentando cargar archivo embebido ./playlist.txt")
        const response = await fetch("./playlist.txt")
        if (response.ok) {
          const text = await response.text()
          const parser = new M3UParser()
          this.allCategories = parser.parse(text)
          if (this.allCategories.length === 0) {
            throw new Error("No se encontraron categorías en el archivo embebido")
          }
          console.log("[v0] Playlist cargada desde archivo embebido")
          setTimeout(() => {
            this.showMainScreen()
          }, 500)
          return
        }
      } catch (e) {
        console.warn("[v0] No se encontró playlist embebida:", e)
      }

      throw new Error("No se pudo cargar la playlist desde ninguna fuente")
    } catch (error) {
      console.error("[v0] Error al cargar playlist:", error)
      alert(
        "No se pudo cargar la playlist.\n\n" +
          "Verifica que REMOTE_PLAYLIST_URL esté configurada correctamente en app.js.\n" +
          "URL actual: " +
          REMOTE_PLAYLIST_URL,
      )
      this.showScreen("upload")
      this.setupUploadScreen()
    } finally {
      this.showLoading(false)
    }
  }

  setupLoginScreen() {
    const form = document.getElementById("login-form")
    const usernameInput = document.getElementById("username")
    const passwordInput = document.getElementById("password")
    const loginButton = document.querySelector(".login-button")
    const loginError = document.getElementById("login-error")

    const items = [usernameInput, passwordInput, loginButton]
    let currentIndex = 0

    const focusItem = (index) => {
      items.forEach((item) => item.classList.remove("focused"))
      items[index].classList.add("focused")
      if (items[index].tagName === "INPUT") {
        items[index].focus()
      }
    }

    const handleKeyDown = (e) => {
      const isInput = e.target.tagName === "INPUT"
      if (isInput && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        return // Permitir mover el cursor
      }

      if (e.key === "ArrowDown") {
        e.preventDefault()
        currentIndex = (currentIndex + 1) % items.length
        focusItem(currentIndex)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        currentIndex = (currentIndex - 1 + items.length) % items.length
        focusItem(currentIndex)
      } else if (e.key === "Enter") {
        e.preventDefault()
        if (currentIndex === 2) {
          loginButton.click()
        } else {
          form.dispatchEvent(new Event("submit"))
        }
      }
    }

    items.forEach((item, index) => {
      if (item.tagName === "INPUT") {
        item.addEventListener("focus", () => {
          currentIndex = index
          focusItem(index)
        })
      }
      item.addEventListener("keydown", handleKeyDown)
    })

    passwordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        form.dispatchEvent(new Event("submit"))
      }
    })

    loginButton.addEventListener("click", (e) => {
      e.preventDefault()
      form.dispatchEvent(new Event("submit"))
    })

    form.addEventListener("submit", (e) => {
      e.preventDefault()

      const username = usernameInput.value.trim()
      const password = passwordInput.value.trim()

      if (username === "miuser" && password === "mipass") {
        this.isLoggedIn = true
        this.username = username
        localStorage.setItem("netflis_logged_in", "true")
        localStorage.setItem("netflis_username", username)
        loginError.textContent = ""
        this.loadPlaylistFromBackend()
      } else {
        loginError.textContent = "Usuario o contraseña incorrectos"
        passwordInput.value = ""
        currentIndex = 1
        focusItem(1)
      }
    })

    focusItem(0)
  }

  setupUploadScreen() {
    if (this.uploadScreenSetup) return
    this.uploadScreenSetup = true
    const status = document.getElementById("upload-status")
    if (status) {
      status.textContent = "La playlist se descargará automáticamente. Si falla, revisa configuración."
    }
  }

  async handleFileUpload(file) {
    if (!file) return

    this.showLoading(true)
    document.getElementById("upload-status").textContent = "Procesando archivo..."

    try {
      this.allCategories = await M3UParser.loadFromFile(file)

      if (this.allCategories.length === 0) {
        throw new Error("No se encontraron categorías en el archivo")
      }

      document.getElementById("upload-status").textContent =
        `✓ ${this.allCategories.length} categorías cargadas correctamente`

      setTimeout(() => {
        this.showMainScreen()
      }, 800)
    } catch (error) {
      console.error("Error al cargar archivo:", error)
      document.getElementById("upload-status").textContent = `✗ Error: ${error.message}`
    } finally {
      this.showLoading(false)
    }
  }

  showMainScreen() {
    this.showScreen("main")

    const userBtn = document.getElementById("user-profile-btn")
    userBtn.textContent = this.username

    const tabs = document.querySelectorAll(".nav-tab")
    const searchInput = document.getElementById("global-search")

    searchInput.addEventListener("focus", () => {
      searchInput.classList.add("focused")
    })

    searchInput.addEventListener("blur", () => {
      searchInput.classList.remove("focused")
    })

    this.currentContentType = "tv"
    tabs[0].classList.add("active")
    this.renderCategoriesForType("tv")

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const type = tab.getAttribute("data-type")
        tabs.forEach((t) => t.classList.remove("active"))
        tab.classList.add("active")
        this.currentContentType = type
        this.currentSearchQuery = ""
        searchInput.value = ""
        this.renderCategoriesForType(type)
      })
    })

    searchInput.addEventListener("input", (e) => {
      this.currentSearchQuery = e.target.value.toLowerCase()
      this.renderCategoriesForType(this.currentContentType)
    })

    userBtn.addEventListener("click", () => {
      this.showUserProfile()
    })
  }

  renderCategoriesForType(type) {
    const container = document.getElementById("categories-content")
    container.innerHTML = ""

    this.categories = this.allCategories
      .map((category) => {
        const filteredMovies = category.movies.filter((movie) => {
          const matchesType = movie.contentType === type
          const matchesSearch = this.currentSearchQuery
            ? movie.title.toLowerCase().includes(this.currentSearchQuery)
            : true
          return matchesType && matchesSearch
        })

        if (filteredMovies.length === 0) return null

        return {
          name: category.name,
          count: filteredMovies.length,
          movies: filteredMovies,
        }
      })
      .filter((cat) => cat !== null)

    if (this.categories.length === 0) {
      container.innerHTML = '<div class="no-results">No se encontraron resultados</div>'
      return
    }

    this.categories.forEach((category) => {
      const categorySection = this.createCategorySection(category)
      container.appendChild(categorySection)
    })

    this.setupMainScreenNavigation()
  }

  setupMainScreenNavigation() {
    const tabs = Array.from(document.querySelectorAll(".nav-tab"))
    const searchInput = document.getElementById("global-search")
    const userBtn = document.getElementById("user-profile-btn")

    const headerItems = [...tabs, searchInput, userBtn]

    const categoryLevels = []
    const categorySections = document.querySelectorAll(".category-section")

    categorySections.forEach((section) => {
      const cards = Array.from(section.querySelectorAll(".movie-card, .show-all-card"))
      if (cards.length > 0) {
        categoryLevels.push(cards)
      }
    })

    const allLevels = [headerItems, ...categoryLevels]

    this.navigation.setMultiLevelItems(allLevels)
  }

  showUserProfile() {
    const modal = document.getElementById("user-profile-modal")
    modal.classList.add("active")

    const usernameDisplay = document.getElementById("profile-username")
    const logoutBtn = document.getElementById("profile-logout-btn")
    const closeBtn = document.getElementById("close-profile-btn")
    const refreshBtn = document.getElementById("profile-refresh-btn")

    usernameDisplay.textContent = this.username

    const handleRefresh = async () => {
      await this.clearLocalPlaylist()
      alert("Lista actualizada. Recargando...")
      location.reload()
    }

    const handleLogout = () => {
      const confirmLogout = confirm("¿Deseas cerrar sesión?")
      if (confirmLogout) {
        localStorage.removeItem("netflis_logged_in")
        localStorage.removeItem("netflis_username")
        this.isLoggedIn = false
        this.username = ""
        modal.classList.remove("active")
        this.showScreen("login")
        this.setupLoginScreen()
      }
    }

    const handleClose = () => {
      modal.classList.remove("active")
      this.showMainScreen()
    }

    refreshBtn.onclick = handleRefresh
    logoutBtn.onclick = handleLogout
    closeBtn.onclick = handleClose

    this.navigation.setItems([refreshBtn, logoutBtn, closeBtn], 3, true)

    const handleModalKeys = (e) => {
      if (e.key === "Escape" || e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault()
        handleClose()
        window.removeEventListener("keydown", handleModalKeys)
      }
    }
    window.addEventListener("keydown", handleModalKeys)
  }

  groupSeriesByName(movies) {
    const seriesMap = new Map()

    movies.forEach((movie) => {
      const seriesName = movie.seriesName || movie.title
      if (!seriesMap.has(seriesName)) {
        seriesMap.set(seriesName, [])
      }
      seriesMap.get(seriesName).push(movie)
    })

    seriesMap.forEach((episodes, seriesName) => {
      episodes.sort((a, b) => {
        if (a.season !== b.season) return a.season - b.season
        return a.episode - b.episode
      })
    })

    return seriesMap
  }

  getContentLabel() {
    switch (this.currentContentType) {
      case "tv":
        return "canales"
      case "movies":
        return "películas"
      case "series":
        return "series"
      default:
        return "items"
    }
  }

  createSeriesCard(seriesName, episodes) {
    const card = document.createElement("div")
    card.className = "movie-card"

    const firstEpisode = episodes[0]
    const posterContent = firstEpisode.logo ? `<img src="${firstEpisode.logo}" alt="${seriesName}">` : "📺"

    const episodeCount = episodes.length

    card.innerHTML = `
      <div class="movie-poster">${posterContent}</div>
      <div class="movie-info">
        <div class="movie-title">${seriesName}</div>
        <div class="movie-meta">${episodeCount} episodios</div>
      </div>
    `

    card.addEventListener("click", () => {
      this.showEpisodesScreen(seriesName, episodes)
    })

    return card
  }

  showEpisodesScreen(seriesName, episodes) {
    this.currentSeries = { name: seriesName, episodes }
    this.currentSearchQuery = ""
    this.showScreen("episodes")

    const seriesTitle = document.getElementById("series-title")
    const totalEpisodes = document.getElementById("total-episodes")
    const episodesContainer = document.getElementById("episodes-container")
    const backBtn = document.getElementById("back-to-series")
    const continueBtn = document.getElementById("continue-watching-btn")
    const searchInput = document.getElementById("episode-search")

    seriesTitle.textContent = seriesName
    episodesContainer.innerHTML = ""

    searchInput.value = ""
    searchInput.style.display = "block"

    searchInput.addEventListener("focus", () => {
      searchInput.classList.add("focused")
    })

    searchInput.addEventListener("blur", () => {
      searchInput.classList.remove("focused")
    })

    const renderFilteredEpisodes = (query = "") => {
      episodesContainer.innerHTML = ""
      this.currentSearchQuery = query.toLowerCase()

      const filteredEpisodes = episodes.filter(
        (episode) =>
          episode.episodeTitle.toLowerCase().includes(this.currentSearchQuery) ||
          `T${episode.season} E${episode.episode}`.toLowerCase().includes(this.currentSearchQuery),
      )

      totalEpisodes.textContent = `${filteredEpisodes.length} episodios disponibles`

      filteredEpisodes.forEach((episode) => {
        const card = this.createEpisodeCard(episode)
        episodesContainer.appendChild(card)
      })

      const cards = episodesContainer.querySelectorAll(".episode-card")
      const allItems =
        continueBtn.style.display === "block"
          ? [searchInput, continueBtn, ...Array.from(cards)]
          : [searchInput, ...Array.from(cards)]

      this.navigation.setItems(allItems, 4, false)
    }

    searchInput.addEventListener("input", (e) => {
      renderFilteredEpisodes(e.target.value)
    })

    renderFilteredEpisodes()

    backBtn.onclick = () => {
      searchInput.style.display = "none"
      this.showMainScreen()
    }
  }

  createEpisodeCard(episode) {
    const card = document.createElement("div")
    card.className = "episode-card"

    const posterContent = episode.logo ? `<img src="${episode.logo}" alt="${episode.episodeTitle}">` : "📺"

    const episodeLabel = `T${episode.season} E${episode.episode}`
    const episodeBadge = `T${episode.season} | E${episode.episode}`

    card.innerHTML = `
      <div class="episode-poster">
        ${posterContent}
        <div class="episode-badge">${episodeBadge}</div>
      </div>
      <div class="episode-info">
        <div class="episode-number">${episodeLabel}</div>
        <div class="episode-title">${episode.episodeTitle}</div>
      </div>
    `

    card.addEventListener("click", () => {
      this.playMovie(episode)
    })

    return card
  }

  createMovieCard(movie) {
    const card = document.createElement("div")
    card.className = "movie-card"

    const posterContent = movie.logo ? `<img src="${movie.logo}" alt="${movie.title}">` : "🎥"

    card.innerHTML = `
      <div class="movie-poster">${posterContent}</div>
      <div class="movie-info">
        <div class="movie-title">${movie.title}</div>
        <div class="movie-meta">${movie.category}</div>
      </div>
    `

    card.addEventListener("click", () => {
      this.playMovie(movie)
    })

    return card
  }

  createShowAllCard(category) {
    const card = document.createElement("div")
    card.className = "show-all-card movie-card"

    card.innerHTML = `
      <div class="show-all-content">
        <div class="show-all-icon">📋</div>
        <div class="show-all-text">Mostrar todo</div>
        <div class="show-all-count">${category.count} ${this.getContentLabel()}</div>
      </div>
    `

    card.addEventListener("click", () => {
      this.showFullCategoryScreen(category)
    })

    return card
  }

  showFullCategoryScreen(category) {
    this.currentCategory = category
    this.currentSearchQuery = ""
    this.showScreen("movies")

    const categoryTitle = document.getElementById("category-title")
    const totalMovies = document.getElementById("total-movies")
    const carousel = document.getElementById("movies-carousel")
    const backBtn = document.getElementById("back-to-categories")
    const searchInput = document.getElementById("category-search")

    categoryTitle.textContent = category.name
    totalMovies.textContent = `${category.count} ${this.getContentLabel()} disponibles`
    carousel.innerHTML = ""

    searchInput.value = ""
    searchInput.style.display = "block"

    searchInput.addEventListener("focus", () => {
      searchInput.classList.add("focused")
    })

    searchInput.addEventListener("blur", () => {
      searchInput.classList.remove("focused")
    })

    const renderFilteredContent = (query = "") => {
      carousel.innerHTML = ""
      this.currentSearchQuery = query.toLowerCase()

      if (this.currentContentType === "series") {
        const seriesMap = this.groupSeriesByName(category.movies)
        const filteredSeries = Array.from(seriesMap.entries()).filter(([seriesName]) =>
          seriesName.toLowerCase().includes(this.currentSearchQuery),
        )

        totalMovies.textContent = `${filteredSeries.length} series disponibles`

        const row = document.createElement("div")
        row.className = "carousel-row"

        filteredSeries.forEach(([seriesName, episodes]) => {
          const card = this.createSeriesCard(seriesName, episodes)
          row.appendChild(card)
        })

        carousel.appendChild(row)

        const cards = row.querySelectorAll(".movie-card")
        this.navigation.setItems([searchInput, ...Array.from(cards)], cards.length, true)
      } else {
        const filteredMovies = category.movies.filter((movie) =>
          movie.title.toLowerCase().includes(this.currentSearchQuery),
        )

        totalMovies.textContent = `${filteredMovies.length} ${this.getContentLabel()} disponibles`

        const row = document.createElement("div")
        row.className = "carousel-row"

        filteredMovies.forEach((movie) => {
          const card = this.createMovieCard(movie)
          row.appendChild(card)
        })

        carousel.appendChild(row)

        const cards = row.querySelectorAll(".movie-card")
        this.navigation.setItems([searchInput, ...Array.from(cards)], cards.length, true)
      }
    }

    searchInput.addEventListener("input", (e) => {
      renderFilteredContent(e.target.value)
    })

    renderFilteredContent()

    backBtn.onclick = () => {
      searchInput.style.display = "none"
      this.showMainScreen()
    }
  }

  playMovie(movie, startTime = 0) {
    this.showScreen("player")

    const video = document.getElementById("video-player")
    const playerTitle = document.getElementById("player-title")
    const playerCategory = document.getElementById("player-category")
    const closeBtn = document.getElementById("close-player")

    playerTitle.textContent = movie.episodeTitle || movie.title
    playerCategory.textContent = movie.category

    video.src = movie.url
    video.load()

    if (startTime > 0) {
      video.currentTime = startTime
    }

    video
      .play()
      .then(() => {
        try {
          if (video.requestFullscreen) video.requestFullscreen()
          else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen()
          else if (video.mozRequestFullScreen) video.mozRequestFullScreen()
          else if (video.msRequestFullscreen) video.msRequestFullscreen()
        } catch (e) {
          console.debug("Fullscreen no permitido:", e && e.message)
        }
      })
      .catch((error) => {
        console.error("Error al reproducir:", error)
        alert("Error al reproducir el video. Verifica la URL.")
      })

    let progressInterval
    if (movie.contentType === "series") {
      progressInterval = setInterval(() => {
        if (!video.paused && video.currentTime > 0) {
          this.updateProgress(movie.seriesName, movie.season, movie.episode, video.currentTime)
        }
      }, 10000)
    }

    closeBtn.onclick = () => {
      if (progressInterval) clearInterval(progressInterval)
      this.closePlayer()
    }

    const handleEsc = (e) => {
      if (e.key === "Escape") {
        if (progressInterval) clearInterval(progressInterval)
        this.closePlayer()
        window.removeEventListener("keydown", handleEsc)
      }
    }
    window.addEventListener("keydown", handleEsc)

    this.navigation.currentScreen = "player"
  }

  async closePlayer() {
    const video = document.getElementById("video-player")
    await this.exitFullscreenIfNeeded().catch(() => {})
    video.pause()
    video.src = ""

    if (this.currentContentType === "series" && this.currentSeries) {
      this.showEpisodesScreen(this.currentSeries.name, this.currentSeries.episodes)
    } else if (this.currentCategory) {
      this.showFullCategoryScreen(this.currentCategory)
    } else {
      this.showMainScreen()
    }
  }

  handleBack() {
    const currentScreen = this.navigation.currentScreen

    switch (currentScreen) {
      case "main":
        break
      case "movies":
        this.showMainScreen()
        break
      case "episodes":
        this.showFullCategoryScreen(this.currentCategory)
        break
      case "player":
        this.closePlayer()
        break
    }
  }

  showScreen(screenName) {
    document.querySelectorAll(".screen").forEach((screen) => {
      screen.classList.remove("active")
    })

    const screen = document.getElementById(`${screenName}-screen`)
    if (screen) {
      screen.classList.add("active")
      this.navigation.currentScreen = screenName
    }
  }

  showLoading(show) {
    const loading = document.getElementById("loading")
    loading.classList.toggle("active", show)
  }

  isInFullscreen() {
    return !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    )
  }

  async exitFullscreenIfNeeded() {
    try {
      if (this.isInFullscreen()) {
        if (document.exitFullscreen) await document.exitFullscreen()
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen()
        else if (document.mozCancelFullScreen) await document.mozCancelFullScreen()
        else if (document.msExitFullscreen) await document.msExitFullscreen()
        return true
      }
    } catch (e) {
      console.debug("Error al salir de fullscreen:", e && e.message)
    }
    return false
  }

  setupGlobalBackHandler() {
    window.addEventListener("keydown", async (e) => {
      const key = e.key
      const code = e.keyCode || e.which
      const isBackKey =
        key === "Back" ||
        key === "Backspace" ||
        key === "BrowserBack" ||
        key === "SoftLeft" ||
        key === "MediaBack" ||
        key === "Escape" ||
        key === "Delete" ||
        code === 4 ||
        code === 8 ||
        code === 27 ||
        code === 46 ||
        code === 10009

      if (!isBackKey) return

      const video = document.getElementById("video-player")
      if (video && !video.paused && this.isInFullscreen()) {
        e.preventDefault()
        const exited = await this.exitFullscreenIfNeeded()
        if (exited) {
          return
        }
      }

      if (video && !video.paused) {
        e.preventDefault()
        this.closePlayer()
        return
      }

      e.preventDefault()
      this.handleBack()
    })
  }

  createCategorySection(category) {
    const section = document.createElement("div")
    section.className = "category-section"

    const header = document.createElement("div")
    header.className = "category-header"

    const title = document.createElement("h2")
    title.className = "category-title"

    const categoryLogo = this.categoryLogos.get(category.name)
    if (categoryLogo) {
      const logoImg = document.createElement("img")
      logoImg.src = categoryLogo
      logoImg.alt = category.name
      logoImg.className = "category-logo-inline"
      title.appendChild(logoImg)
    }

    const titleText = document.createElement("span")
    titleText.textContent = category.name
    title.appendChild(titleText)

    const count = document.createElement("span")
    count.className = "category-count-inline"
    count.textContent = ` ${category.count} ${this.getContentLabel()}`
    title.appendChild(count)

    header.appendChild(title)
    section.appendChild(header)

    const carousel = document.createElement("div")
    carousel.className = "category-carousel"

    if (this.currentContentType === "series") {
      const seriesMap = this.groupSeriesByName(category.movies)
      const seriesArray = Array.from(seriesMap.entries())

      const limitedSeries = seriesArray.slice(0, 5)

      limitedSeries.forEach(([seriesName, episodes]) => {
        const card = this.createSeriesCard(seriesName, episodes)
        carousel.appendChild(card)
      })

      if (seriesArray.length > 5) {
        const showAllCard = this.createShowAllCard(category)
        carousel.appendChild(showAllCard)
      }
    } else {
      const limitedMovies = category.movies.slice(0, 5)

      limitedMovies.forEach((movie) => {
        const card = this.createMovieCard(movie)
        carousel.appendChild(card)
      })

      if (category.movies.length > 5) {
        const showAllCard = this.createShowAllCard(category)
        carousel.appendChild(showAllCard)
      }
    }

    section.appendChild(carousel)
    return section
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new NetflisApp()
})
