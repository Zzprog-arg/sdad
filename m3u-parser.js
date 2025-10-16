// Parser de archivos M3U con clasificación de contenido
class M3UParser {
  constructor() {
    this.categories = new Map()
  }

  detectContentType(movie) {
    const url = movie.url.toLowerCase()
    const title = movie.title.toLowerCase()

    // Detectar series por patrones S01E01, S01 E01, etc.
    const seriesPatterns = [
      /s\d{1,2}e\d{1,2}/i,
      /s\d{1,2}\s+e\d{1,2}/i,
      /season\s*\d+/i,
      /temporada\s*\d+/i,
      /capitulo\s*\d+/i,
      /episodio\s*\d+/i,
    ]

    const isSeries = seriesPatterns.some((pattern) => pattern.test(title) || pattern.test(url))

    if (isSeries) {
      return "series"
    }

    // Detectar películas por extensión
    const movieExtensions = [".mp4", ".ts", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm"]
    const isMovie = movieExtensions.some((ext) => url.endsWith(ext))

    if (isMovie) {
      return "movies"
    }

    // Todo lo demás es TV
    return "tv"
  }

  extractSeriesInfo(title) {
    // Patrones para detectar episodios
    const episodePatterns = [
      /(.+?)\s*[Ss](\d{1,2})[Ee](\d{1,2})/, // Serie S01E01
      /(.+?)\s*[Ss](\d{1,2})\s+[Ee](\d{1,2})/, // Serie S01 E01
      /(.+?)\s*[Tt]emporada\s*(\d+)\s*[Cc]apitulo\s*(\d+)/i, // Temporada X Capitulo Y
      /(.+?)\s*[Ss]eason\s*(\d+)\s*[Ee]pisode\s*(\d+)/i, // Season X Episode Y
    ]

    for (const pattern of episodePatterns) {
      const match = title.match(pattern)
      if (match) {
        return {
          seriesName: match[1].trim(),
          season: Number.parseInt(match[2]),
          episode: Number.parseInt(match[3]),
          fullTitle: title,
        }
      }
    }

    // Si no se encuentra patrón, usar el título completo como nombre de serie
    return {
      seriesName: title,
      season: 1,
      episode: 1,
      fullTitle: title,
    }
  }

  parse(content) {
    const lines = content.split("\n").map((line) => line.trim())
    let currentMovie = null

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Detectar línea EXTINF (información de la película)
      if (line.startsWith("#EXTINF:")) {
        currentMovie = this.parseExtinf(line)
      }
      // La siguiente línea después de EXTINF es la URL
      else if (currentMovie && line && !line.startsWith("#")) {
        currentMovie.url = line
        currentMovie.contentType = this.detectContentType(currentMovie)

        if (currentMovie.contentType === "series") {
          const seriesInfo = this.extractSeriesInfo(currentMovie.title)
          currentMovie.seriesName = seriesInfo.seriesName
          currentMovie.season = seriesInfo.season
          currentMovie.episode = seriesInfo.episode
          currentMovie.episodeTitle = seriesInfo.fullTitle
        }

        this.addMovieToCategory(currentMovie)
        currentMovie = null
      }
    }

    return this.getCategoriesArray()
  }

  parseExtinf(line) {
    const movie = {
      title: "",
      category: "Sin Categoría",
      group: "",
      logo: "",
      url: "",
      contentType: "movies",
    }

    // Extraer título (última parte después de la coma)
    const titleMatch = line.match(/,(.+)$/)
    if (titleMatch) {
      movie.title = titleMatch[1].trim()
    }

    // Extraer group-title (categoría)
    const groupMatch = line.match(/group-title="([^"]+)"/i)
    if (groupMatch) {
      movie.category = groupMatch[1].trim()
      movie.group = groupMatch[1].trim()
    }

    // Extraer logo/tvg-logo
    const logoMatch = line.match(/tvg-logo="([^"]+)"/i)
    if (logoMatch) {
      movie.logo = logoMatch[1].trim()
    }

    return movie
  }

  addMovieToCategory(movie) {
    if (!this.categories.has(movie.category)) {
      this.categories.set(movie.category, [])
    }
    this.categories.get(movie.category).push(movie)
  }

  getCategoriesArray() {
    const result = []
    this.categories.forEach((movies, categoryName) => {
      result.push({
        name: categoryName,
        count: movies.length,
        movies: movies,
      })
    })
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }

  static async loadFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()

      reader.onload = (e) => {
        try {
          const parser = new M3UParser()
          const categories = parser.parse(e.target.result)
          resolve(categories)
        } catch (error) {
          reject(error)
        }
      }

      reader.onerror = () => reject(new Error("Error al leer el archivo"))
      reader.readAsText(file)
    })
  }
}

export default M3UParser
