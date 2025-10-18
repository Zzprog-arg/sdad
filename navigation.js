class TVNavigation {
  constructor() {
    this.currentScreen = "upload"
    this.focusedIndex = 0
    this.items = []
    this.columns = 0
    this.isHorizontal = true
    this.setupKeyboardListeners()
  }

  setupKeyboardListeners() {
    document.addEventListener("keydown", (e) => {
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

  setItems(items, columns = 4, horizontal = false) {
    this.items = items
    this.columns = columns
    this.isHorizontal = horizontal
    this.focusedIndex = 0
    this.updateFocus()
  }

  moveUp() {
    if (this.isHorizontal) {
      // En modo horizontal, no hacer nada o ir al elemento anterior
      if (this.focusedIndex > 0) {
        this.focusedIndex--
        this.updateFocus()
      }
    } else {
      // En modo grid, moverse una fila arriba
      const currentRow = Math.floor(this.focusedIndex / this.columns)
      const currentCol = this.focusedIndex % this.columns

      if (currentRow > 0) {
        const newIndex = (currentRow - 1) * this.columns + currentCol
        if (newIndex < this.items.length) {
          this.focusedIndex = newIndex
        } else {
          // Si no hay elemento en esa posición, ir al último de la fila anterior
          this.focusedIndex = Math.min((currentRow - 1) * this.columns + this.columns - 1, this.items.length - 1)
        }
        this.updateFocus()
      }
    }
  }

  moveDown() {
    if (this.isHorizontal) {
      // En modo horizontal, ir al siguiente elemento
      if (this.focusedIndex < this.items.length - 1) {
        this.focusedIndex++
        this.updateFocus()
      }
    } else {
      // En modo grid, moverse una fila abajo
      const currentRow = Math.floor(this.focusedIndex / this.columns)
      const currentCol = this.focusedIndex % this.columns
      const totalRows = Math.ceil(this.items.length / this.columns)

      if (currentRow < totalRows - 1) {
        const newIndex = (currentRow + 1) * this.columns + currentCol
        if (newIndex < this.items.length) {
          this.focusedIndex = newIndex
        } else {
          // Si no hay elemento en esa posición, ir al último elemento
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
    this.items.forEach((item) => item.classList.remove("focused"))

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
