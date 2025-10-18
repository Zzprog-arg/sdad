class TVNavigation {
  constructor() {
    this.currentScreen = "upload"
    this.focusedIndex = 0
    this.items = []
    this.columns = 0
    this.isHorizontal = true
    this.navigationLevels = [] // Array de arrays de items
    this.currentLevel = 0
    this.setupKeyboardListeners()
  }

  setupKeyboardListeners() {
    document.addEventListener("keydown", (e) => {
      const activeElement = document.activeElement
      if (activeElement && (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA")) {
        if (e.key === "Backspace" || e.key === "Delete") {
          // Permitir que el input maneje el borrado normalmente
          return
        }
      }

      this.handleKeyPress(e)
    })
  }

  handleKeyPress(e) {
    const key = e.key

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
      case "Escape":
        e.preventDefault()
        this.back()
        break
      case "Delete":
      case "Backspace":
        e.preventDefault()
        this.back()
        break
      case " ":
        if (this.currentScreen === "player") {
          e.preventDefault()
          this.togglePlayPause()
        }
        break
    }
  }

  setMultiLevelItems(levels) {
    this.navigationLevels = levels
    this.currentLevel = 0
    this.focusedIndex = 0
    this.items = levels[0] || []
    this.updateFocus()
  }

  setItems(items, columns = 4, horizontal = false) {
    this.items = items
    this.columns = columns
    this.isHorizontal = horizontal
    this.focusedIndex = 0
    this.navigationLevels = []
    this.currentLevel = 0
    this.updateFocus()
  }

  moveUp() {
    if (this.navigationLevels.length > 0) {
      // Navegación multi-nivel
      if (this.currentLevel > 0) {
        // Subir al nivel anterior
        this.currentLevel--
        this.items = this.navigationLevels[this.currentLevel]
        this.focusedIndex = Math.min(this.focusedIndex, this.items.length - 1)
        this.updateFocus()
      }
      return
    }

    if (this.isHorizontal) {
      if (this.focusedIndex > 0) {
        this.focusedIndex--
        this.updateFocus()
      }
    } else {
      const currentRow = Math.floor(this.focusedIndex / this.columns)
      const currentCol = this.focusedIndex % this.columns

      if (currentRow > 0) {
        const newIndex = (currentRow - 1) * this.columns + currentCol
        if (newIndex < this.items.length) {
          this.focusedIndex = newIndex
        } else {
          this.focusedIndex = Math.min((currentRow - 1) * this.columns + this.columns - 1, this.items.length - 1)
        }
        this.updateFocus()
      }
    }
  }

  moveDown() {
    if (this.navigationLevels.length > 0) {
      // Navegación multi-nivel
      if (this.currentLevel < this.navigationLevels.length - 1) {
        // Bajar al siguiente nivel
        this.currentLevel++
        this.items = this.navigationLevels[this.currentLevel]
        this.focusedIndex = Math.min(this.focusedIndex, this.items.length - 1)
        this.updateFocus()
      }
      return
    }

    if (this.isHorizontal) {
      if (this.focusedIndex < this.items.length - 1) {
        this.focusedIndex++
        this.updateFocus()
      }
    } else {
      const currentRow = Math.floor(this.focusedIndex / this.columns)
      const currentCol = this.focusedIndex % this.columns
      const totalRows = Math.ceil(this.items.length / this.columns)

      if (currentRow < totalRows - 1) {
        const newIndex = (currentRow + 1) * this.columns + currentCol
        if (newIndex < this.items.length) {
          this.focusedIndex = newIndex
        } else {
          this.focusedIndex = this.items.length - 1
        }
        this.updateFocus()
      }
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
    // Remover focus de todos los items en todos los niveles
    if (this.navigationLevels.length > 0) {
      this.navigationLevels.forEach((level) => {
        level.forEach((item) => item.classList.remove("focused"))
      })
    } else {
      this.items.forEach((item) => item.classList.remove("focused"))
    }

    if (this.items[this.focusedIndex]) {
      this.items[this.focusedIndex].classList.add("focused")
      this.scrollIntoView(this.items[this.focusedIndex])
    }
  }

  scrollIntoView(element) {
    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
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
}

export default TVNavigation
