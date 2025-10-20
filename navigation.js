// Sistema de navegación con teclado para TV Box
class TVNavigation {
  constructor() {
    this.currentScreen = "upload"
    this.focusedIndex = 0
    this.items = []
    this.columns = 0
    this.setupKeyboardListeners()
  }

  setupKeyboardListeners() {
    document.addEventListener("keydown", (e) => {
      this.handleKeyPress(e)
    })
  }

  isBackKey(e) {
    // Teclas comunes de "volver atrás" en TV Box y controles remotos
    const backKeys = [
      "Escape", // Teclado estándar
      "Backspace", // Teclado y algunos controles
      "Back", // Algunos controles remotos
      "BrowserBack", // Navegadores
      "GoBack", // Algunos dispositivos
    ]

    const backKeyCodes = [
      27, // Escape
      8, // Backspace
      461, // Back en Android TV
      10009, // Return/Back en Samsung TV
      166, // MediaBack
      4, // Back en algunos dispositivos Android
    ]

    return backKeys.includes(e.key) || backKeyCodes.includes(e.keyCode)
  }

  handleKeyPress(e) {
    const key = e.key

    const activeElement = document.activeElement
    const isInputFocused = activeElement && (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA")

    if (this.isBackKey(e)) {
      // Si un input tiene focus, permitir que Backspace funcione normalmente para borrar
      if (isInputFocused) {
        return // No prevenir el comportamiento por defecto
      }
      e.preventDefault()
      this.back()
      return
    }

    if (isInputFocused && (key === "ArrowLeft" || key === "ArrowRight")) {
      return // Permitir mover el cursor dentro del input
    }

    switch (key) {
      case "ArrowUp":
        e.preventDefault()
        this.moveUp()
        break
      case "ArrowDown":
        e.preventDefault()
        this.moveDown()
        break
      case "ArrowLeft":
        e.preventDefault()
        this.moveLeft()
        break
      case "ArrowRight":
        e.preventDefault()
        this.moveRight()
        break
      case "Enter":
        e.preventDefault()
        this.select()
        break
      case " ":
        if (this.currentScreen === "player") {
          e.preventDefault()
          this.togglePlayPause()
        }
        break
    }
  }

  setItems(items, columns = 4) {
    this.items = items
    this.columns = columns
    this.focusedIndex = 0
    this.updateFocus()
  }

  moveUp() {
    if (this.focusedIndex >= this.columns) {
      this.focusedIndex -= this.columns
      this.updateFocus()
    }
  }

  moveDown() {
    if (this.focusedIndex + this.columns < this.items.length) {
      this.focusedIndex += this.columns
      this.updateFocus()
    }
  }

  moveLeft() {
    if (this.focusedIndex > 0) {
      this.focusedIndex--
      this.updateFocus()
    }
  }

  moveRight() {
    if (this.focusedIndex < this.items.length - 1) {
      this.focusedIndex++
      this.updateFocus()
    }
  }

  updateFocus() {
    // Remover focus de todos los items
    this.items.forEach((item) => item.classList.remove("focused"))

    // Agregar focus al item actual
    if (this.items[this.focusedIndex]) {
      this.items[this.focusedIndex].classList.add("focused")

      const currentItem = this.items[this.focusedIndex]
      if (currentItem.tagName === "INPUT" || currentItem.tagName === "TEXTAREA") {
        currentItem.focus()
      }

      this.scrollIntoView(this.items[this.focusedIndex])
    }
  }

  scrollIntoView(element) {
    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
    })
  }

  select() {
    if (this.items[this.focusedIndex]) {
      this.items[this.focusedIndex].click()
    }
  }

  back() {
    window.dispatchEvent(new CustomEvent("navigation-back"))
  }

  togglePlayPause() {
    const video = document.getElementById("video-player")
    if (video) {
      if (video.paused) {
        video.play()
      } else {
        video.pause()
      }
    }
  }

  calculateColumns() {
    const grid = document.querySelector(".grid")
    if (!grid) return 4

    const gridWidth = grid.offsetWidth
    const cardWidth = 280 + 25 // card width + gap
    return Math.floor(gridWidth / cardWidth) || 4
  }
}

export default TVNavigation
