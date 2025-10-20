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
}

document.addEventListener("DOMContentLoaded", () => {
  new NetflisApp()
})
// Aplicación principal estilo Netflix con sistema de autenticación
import TVNavigation from "./navigation.js"
import M3UParser from "./m3u-parser.js"
import AuthSystem from "./auth.js"

const REMOTE_PLAYLIST_URL = "https://raw.githubusercontent.com/Zzprog-arg/sdad/refs/heads/main/playlist.m3u"
const PLAYLIST_IDB_KEY = "playlist-local"

class NetflisApp {
  constructor() {
    this.navigation = new TVNavigation()
    this.auth = new AuthSystem()
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
    this.currentUser = null
    this.currentSearchQuery = ""
    this.selectedCategoryFilter = null
    this.init()
    this.setupBackHandler()
    this.setupGlobalBackHandler()
  }

  async init() {
    await this.auth.init()
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

  async showSplashScreen() {
    setTimeout(async () => {
      const savedUsername = localStorage.getItem("netflis_username")
      if (savedUsername) {
        try {
          const session = await this.auth.getSession(savedUsername)
          if (session) {
            const user = await this.auth.getUser(savedUsername)
            if (user && user.isActive && Date.now() < user.expiresAt) {
              this.isLoggedIn = true
              this.username = savedUsername
              this.currentUser = user
              this.loadPlaylistFromBackend()
              return
            }
          }
        } catch (error) {
          console.error("Error al restaurar sesión:", error)
        }
        localStorage.removeItem("netflis_username")
      }
      this.showScreen("login")
      this.setupLoginScreen()
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
        return
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

    form.addEventListener("submit", async (e) => {
      e.preventDefault()

      const username = usernameInput.value.trim()
      const password = passwordInput.value.trim()

      if (!username || !password) {
        loginError.textContent = "Complete todos los campos"
        return
      }

      try {
        const user = await this.auth.login(username, password)
        this.isLoggedIn = true
        this.username = username
        this.currentUser = user
        localStorage.setItem("netflis_username", username)
        loginError.textContent = ""
        this.loadPlaylistFromBackend()
      } catch (error) {
        if (error.message === "CUENTA_EXPIRADA") {
          this.showExpiredScreen()
        } else if (error.message === "CUENTA_INACTIVA") {
          loginError.textContent = "Cuenta desactivada. Contacte al reseller"
        } else {
          loginError.textContent = "Usuario o contraseña incorrectos"
        }
        passwordInput.value = ""
        currentIndex = 1
        focusItem(1)
      }
    })

    focusItem(0)
  }

  showExpiredScreen() {
    const loginContainer = document.querySelector(".login-container")
    loginContainer.innerHTML = `
      <h1 class="login-title">⚠️ CUENTA EXPIRADA</h1>
      <div style="text-align: center; padding: 20px;">
        <p style="font-size: 18px; margin-bottom: 20px; color: #d2d2d2;">
          Tu cuenta ha expirado
        </p>
        <p style="font-size: 16px; margin-bottom: 30px; color: #808080;">
          Por favor, contacta a tu reseller para renovar tu suscripción
        </p>
        <button class="login-button" onclick="location.reload()">
          Volver al Login
        </button>
      </div>
    `
  }
