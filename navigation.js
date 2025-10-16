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
    this.columns = horizontal ? items.length : columns
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
    const cardWidth = 280 + 25
    return Math.floor(gridWidth / cardWidth) || 4
  }
}

export default TVNavigation
