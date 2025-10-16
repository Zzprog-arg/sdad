// Aplicación principal estilo Netflix
import TVNavigation from "./navigation.js"
import M3UParser from "./m3u-parser.js"

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
    this.init()
    this.setupBackHandler()
  }

  init() {
    this.loadCategoryLogos()
    this.showSplashScreen()
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

  async loadPlaylistFromBackend() {
    this.showLoading(true)

    try {
      const response = await fetch("./playlist.m3u")

      if (!response.ok) {
        throw new Error("No se pudo cargar el archivo playlist.m3u")
      }

      const text = await response.text()

      const parser = new M3UParser()
      this.allCategories = parser.parse(text)

      if (this.allCategories.length === 0) {
        throw new Error("No se encontraron categorías en el archivo")
      }

      setTimeout(() => {
        this.showContentTypeScreen()
      }, 500)
    } catch (error) {
      console.error("Error al cargar playlist:", error)
      alert(
        "No se encontró playlist.m3u o hay un error de CORS.\n\n" +
          "Asegúrate de:\n" +
          "1. Tener el archivo playlist.m3u en la misma carpeta\n" +
          "2. Estar usando un servidor local (no abrir con file://)\n\n" +
          "Puedes cargar un archivo manualmente.",
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
    const loginError = document.getElementById("login-error")
    const inputs = [usernameInput, passwordInput]
    let currentInputIndex = 0

    const focusInput = (index) => {
      inputs.forEach((input) => input.classList.remove("focused"))
      inputs[index].classList.add("focused")
      inputs[index].focus()
    }

    const handleKeyDown = (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        currentInputIndex = (currentInputIndex + 1) % inputs.length
        focusInput(currentInputIndex)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        currentInputIndex = (currentInputIndex - 1 + inputs.length) % inputs.length
        focusInput(currentInputIndex)
      }
    }

    inputs.forEach((input, index) => {
      input.addEventListener("focus", () => {
        currentInputIndex = index
        focusInput(index)
      })
      input.addEventListener("keydown", handleKeyDown)
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
        focusInput(1)
      }
    })

    focusInput(0)
  }

  setupUploadScreen() {
    if (this.uploadScreenSetup) return
    this.uploadScreenSetup = true

    const uploadBtn = document.getElementById("upload-btn")
    const fileInput = document.getElementById("file-input")

    uploadBtn.addEventListener("click", () => {
      fileInput.click()
    })

    fileInput.addEventListener("change", (e) => {
      this.handleFileUpload(e.target.files[0])
    })
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
        this.showContentTypeScreen()
      }, 800)
    } catch (error) {
      console.error("Error al cargar archivo:", error)
      document.getElementById("upload-status").textContent = `✗ Error: ${error.message}`
    } finally {
      this.showLoading(false)
    }
  }

  showContentTypeScreen() {
    this.showScreen("content-type")

    const counts = this.calculateContentTypeCounts()

    document.getElementById("tv-count").textContent = `${counts.tv} canales`
    document.getElementById("movies-count").textContent = `${counts.movies} películas`
    document.getElementById("series-count").textContent = `${counts.series} series`

    const userBtn = document.getElementById("user-profile-btn")
    userBtn.textContent = this.username

    const cards = document.querySelectorAll(".content-type-card")

    cards.forEach((card) => {
      card.addEventListener("click", () => {
        const type = card.getAttribute("data-type")
        this.selectContentType(type)
      })
    })

    userBtn.addEventListener("click", () => {
      this.showUserProfile()
    })

    this.navigation.setItems([...Array.from(cards), userBtn], 4, false)
  }

  showUserProfile() {
    const modal = document.getElementById("user-profile-modal")
    modal.classList.add("active")

    const usernameDisplay = document.getElementById("profile-username")
    const logoutBtn = document.getElementById("profile-logout-btn")
    const closeBtn = document.getElementById("close-profile-btn")

    usernameDisplay.textContent = this.username

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
      this.showContentTypeScreen()
    }

    logoutBtn.onclick = handleLogout
    closeBtn.onclick = handleClose

    this.navigation.setItems([logoutBtn, closeBtn], 2, true)

    const handleModalKeys = (e) => {
      if (e.key === "Escape" || e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault()
        handleClose()
        window.removeEventListener("keydown", handleModalKeys)
      }
    }
    window.addEventListener("keydown", handleModalKeys)
  }

  calculateContentTypeCounts() {
    const counts = { tv: 0, movies: 0, series: 0 }

    this.allCategories.forEach((category) => {
      category.movies.forEach((movie) => {
        counts[movie.contentType]++
      })
    })

    return counts
  }

  selectContentType(type) {
    this.currentContentType = type

    this.categories = this.allCategories
      .map((category) => {
        const filteredMovies = category.movies.filter((movie) => movie.contentType === type)

        if (filteredMovies.length === 0) return null

        return {
          name: category.name,
          count: filteredMovies.length,
          movies: filteredMovies,
        }
      })
      .filter((cat) => cat !== null)

    this.showCategoriesScreen()
  }

  showCategoriesScreen() {
    this.showScreen("categories")

    const container = document.getElementById("categories-container")
    const totalCategories = document.getElementById("total-categories")
    const contentTypeLabel = document.getElementById("content-type-label")

    const typeLabels = {
      tv: "📺 Canales de TV",
      movies: "🎬 Películas",
      series: "📺 Series",
    }
    contentTypeLabel.textContent = typeLabels[this.currentContentType] || ""

    container.innerHTML = ""
    totalCategories.textContent = `${this.categories.length} categorías`

    this.categories.forEach((category) => {
      const card = this.createCategoryCard(category)
      container.appendChild(card)
    })

    const cards = container.querySelectorAll(".category-card")
    const columns = Math.floor(window.innerWidth / 270)
    this.navigation.setItems(Array.from(cards), columns)
  }

  createCategoryCard(category) {
    const card = document.createElement("div")
    card.className = "category-card"

    const categoryLogo = this.categoryLogos.get(category.name)
    const logoHTML = categoryLogo
      ? `<img src="${categoryLogo}" alt="${category.name}" class="category-logo-img">`
      : `<div class="category-icon">🎬</div>`

    card.innerHTML = `
      <div class="category-backdrop"></div>
      <div class="category-content">
        ${logoHTML}
        <div class="category-name">${category.name}</div>
        <div class="category-count">${category.count} ${this.getContentLabel()}</div>
      </div>
    `

    card.addEventListener("click", () => {
      this.showMoviesScreen(category)
    })

    return card
  }

  getContentLabel() {
    const labels = {
      tv: "canales",
      movies: "películas",
      series: "series",
    }
    return labels[this.currentContentType] || "items"
  }

  showMoviesScreen(category) {
    this.currentCategory = category
    this.showScreen("movies")

    const categoryTitle = document.getElementById("category-title")
    const totalMovies = document.getElementById("total-movies")
    const carousel = document.getElementById("movies-carousel")
    const backBtn = document.getElementById("back-to-categories")

    categoryTitle.textContent = category.name
    carousel.innerHTML = ""

    if (this.currentContentType === "series") {
      const seriesMap = this.groupSeriesByName(category.movies)
      totalMovies.textContent = `${seriesMap.size} series disponibles`

      const row = document.createElement("div")
      row.className = "carousel-row"

      seriesMap.forEach((episodes, seriesName) => {
        const card = this.createSeriesCard(seriesName, episodes)
        row.appendChild(card)
      })

      carousel.appendChild(row)
      const cards = row.querySelectorAll(".movie-card")
      this.navigation.setItems(Array.from(cards), cards.length, true)
    } else {
      totalMovies.textContent = `${category.count} ${this.getContentLabel()} disponibles`

      const row = document.createElement("div")
      row.className = "carousel-row"

      category.movies.forEach((movie) => {
        const card = this.createMovieCard(movie)
        row.appendChild(card)
      })

      carousel.appendChild(row)
      const cards = row.querySelectorAll(".movie-card")
      this.navigation.setItems(Array.from(cards), cards.length, true)
    }

    backBtn.onclick = () => {
      this.showCategoriesScreen()
    }
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
    this.showScreen("episodes")

    const seriesTitle = document.getElementById("series-title")
    const totalEpisodes = document.getElementById("total-episodes")
    const episodesContainer = document.getElementById("episodes-container")
    const backBtn = document.getElementById("back-to-series")
    const continueBtn = document.getElementById("continue-watching-btn")

    seriesTitle.textContent = seriesName
    totalEpisodes.textContent = `${episodes.length} episodios disponibles`
    episodesContainer.innerHTML = ""

    const lastWatched = this.getLastWatched(seriesName)

    if (lastWatched) {
      continueBtn.style.display = "block"
      continueBtn.onclick = () => {
        const episode = episodes.find((ep) => ep.season === lastWatched.season && ep.episode === lastWatched.episode)
        if (episode) {
          this.playMovie(episode, lastWatched.currentTime)
        }
      }
    } else {
      continueBtn.style.display = "none"
    }

    episodes.forEach((episode) => {
      const card = this.createEpisodeCard(episode)
      episodesContainer.appendChild(card)
    })

    const cards = episodesContainer.querySelectorAll(".episode-card")
    const allItems = continueBtn.style.display === "block" ? [continueBtn, ...Array.from(cards)] : Array.from(cards)

    const columns = Math.floor(window.innerWidth / 320)
    this.navigation.setItems(allItems, columns)

    backBtn.onclick = () => {
      this.showMoviesScreen(this.currentCategory)
    }
  }

  createEpisodeCard(episode) {
    const card = document.createElement("div")
    card.className = "episode-card"

    const posterContent = episode.logo ? `<img src="${episode.logo}" alt="${episode.episodeTitle}">` : "📺"

    const episodeLabel = `T${episode.season} E${episode.episode}`

    card.innerHTML = `
      <div class="episode-poster">${posterContent}</div>
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

    video.play().catch((error) => {
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

  closePlayer() {
    const video = document.getElementById("video-player")
    video.pause()
    video.src = ""

    if (this.currentContentType === "series" && this.currentSeries) {
      this.showEpisodesScreen(this.currentSeries.name, this.currentSeries.episodes)
    } else {
      this.showMoviesScreen(this.currentCategory)
    }
  }

  handleBack() {
    const currentScreen = this.navigation.currentScreen

    switch (currentScreen) {
      case "content-type":
        break
      case "categories":
        this.showContentTypeScreen()
        break
      case "movies":
        this.showCategoriesScreen()
        break
      case "episodes":
        this.showMoviesScreen(this.currentCategory)
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
}

document.addEventListener("DOMContentLoaded", () => {
  new NetflisApp()
})
