const { pool } = require("../db")
const fs = require("fs")
const path = require("path")
const multer = require("multer")

// Configuración de multer para subir imágenes
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../uploads")
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9)
    const ext = path.extname(file.originalname)
    cb(null, file.fieldname + "-" + uniqueSuffix + ext)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|webp/
    const mimetype = filetypes.test(file.mimetype)
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase())

    if (mimetype && extname) {
      return cb(null, true)
    }
    cb(new Error("Solo se permiten imágenes (jpeg, jpg, png, webp)"))
  },
}).single("poster")

// Crear una nueva sala de cine
const createCinemaRoom = async (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: err.message })
    }

    try {
      const { name, movieTitle, rows, columns } = req.body

      // Validar datos
      if (!name || !movieTitle || !rows || !columns) {
        return res.status(400).json({ message: "Todos los campos son obligatorios" })
      }

      if (!req.file) {
        return res.status(400).json({ message: "La imagen del póster es obligatoria" })
      }

      // Ruta relativa del póster
      const posterPath = `/uploads/${req.file.filename}`

      // Crear sala de cine
      const [result] = await pool.query(
        "INSERT INTO cinema_rooms (name, movie_title, movie_poster, rows, columns) VALUES (?, ?, ?, ?, ?)",
        [name, movieTitle, posterPath, rows, columns],
      )

      res.status(201).json({
        message: "Sala de cine creada correctamente",
        cinemaRoom: {
          id: result.insertId,
          name,
          movieTitle,
          moviePoster: posterPath,
          rows,
          columns,
        },
      })
    } catch (error) {
      console.error("Error al crear sala de cine:", error)
      res.status(500).json({ message: "Error interno del servidor" })
    }
  })
}

// Obtener todas las salas de cine
const getAllCinemaRooms = async (req, res) => {
  try {
    const [cinemaRooms] = await pool.query("SELECT * FROM cinema_rooms")

    // Para cada sala, calcular asientos disponibles para los próximos 8 días
    const cinemaRoomsWithAvailability = await Promise.all(
      cinemaRooms.map(async (room) => {
        const totalSeats = room.rows * room.columns
        const availability = {}

        // Calcular disponibilidad para los próximos 8 días
        for (let i = 0; i < 8; i++) {
          const date = new Date()
          date.setDate(date.getDate() + i)
          const formattedDate = date.toISOString().split("T")[0]

          // Obtener reservaciones para esta sala y fecha
          const [reservations] = await pool.query(
            "SELECT seats FROM reservations WHERE cinema_room_id = ? AND reservation_date = ?",
            [room.id, formattedDate],
          )

          // Contar asientos reservados
          let reservedSeats = 0
          reservations.forEach((reservation) => {
            const seats = JSON.parse(reservation.seats)
            reservedSeats += seats.length
          })

          availability[formattedDate] = totalSeats - reservedSeats
        }

        return {
          ...room,
          totalSeats,
          availability,
        }
      }),
    )

    res.status(200).json(cinemaRoomsWithAvailability)
  } catch (error) {
    console.error("Error al obtener salas de cine:", error)
    res.status(500).json({ message: "Error interno del servidor" })
  }
}

// Obtener una sala de cine por ID
const getCinemaRoomById = async (req, res) => {
  try {
    const { id } = req.params

    const [cinemaRooms] = await pool.query("SELECT * FROM cinema_rooms WHERE id = ?", [id])

    if (cinemaRooms.length === 0) {
      return res.status(404).json({ message: "Sala de cine no encontrada" })
    }

    const room = cinemaRooms[0]
    const totalSeats = room.rows * room.columns

    // Obtener disponibilidad para los próximos 8 días
    const availability = {}
    const reservedSeatsMap = {}

    for (let i = 0; i < 8; i++) {
      const date = new Date()
      date.setDate(date.getDate() + i)
      const formattedDate = date.toISOString().split("T")[0]

      // Obtener reservaciones para esta sala y fecha
      const [reservations] = await pool.query(
        "SELECT seats FROM reservations WHERE cinema_room_id = ? AND reservation_date = ?",
        [id, formattedDate],
      )

      // Recopilar asientos reservados
      const reservedSeats = []
      reservations.forEach((reservation) => {
        const seats = JSON.parse(reservation.seats)
        reservedSeats.push(...seats)
      })

      availability[formattedDate] = totalSeats - reservedSeats.length
      reservedSeatsMap[formattedDate] = reservedSeats
    }

    res.status(200).json({
      ...room,
      totalSeats,
      availability,
      reservedSeatsMap,
    })
  } catch (error) {
    console.error("Error al obtener sala de cine:", error)
    res.status(500).json({ message: "Error interno del servidor" })
  }
}

// Actualizar datos de película de una sala
const updateCinemaRoomMovie = async (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: err.message })
    }

    try {
      const { id } = req.params
      const { name, movieTitle } = req.body

      // Validar datos
      if (!name || !movieTitle) {
        return res.status(400).json({ message: "El nombre y título de la película son obligatorios" })
      }

      // Verificar que la sala existe
      const [cinemaRooms] = await pool.query("SELECT * FROM cinema_rooms WHERE id = ?", [id])

      if (cinemaRooms.length === 0) {
        return res.status(404).json({ message: "Sala de cine no encontrada" })
      }

      let posterPath = cinemaRooms[0].movie_poster

      // Si se proporciona un nuevo póster, actualizar
      if (req.file) {
        // Eliminar póster anterior si existe y no es el predeterminado
        if (posterPath && !posterPath.includes("default") && fs.existsSync(path.join(__dirname, "..", posterPath))) {
          fs.unlinkSync(path.join(__dirname, "..", posterPath))
        }

        posterPath = `/uploads/${req.file.filename}`
      }

      // Actualizar sala
      await pool.query("UPDATE cinema_rooms SET name = ?, movie_title = ?, movie_poster = ? WHERE id = ?", [
        name,
        movieTitle,
        posterPath,
        id,
      ])

      res.status(200).json({
        message: "Datos de película actualizados correctamente",
        cinemaRoom: {
          id: Number.parseInt(id),
          name,
          movieTitle,
          moviePoster: posterPath,
        },
      })
    } catch (error) {
      console.error("Error al actualizar datos de película:", error)
      res.status(500).json({ message: "Error interno del servidor" })
    }
  })
}

// Actualizar capacidad de una sala
const updateCinemaRoomCapacity = async (req, res) => {
  try {
    const { id } = req.params
    const { rows, columns } = req.body

    // Validar datos
    if (!rows || !columns) {
      return res.status(400).json({ message: "Filas y columnas son obligatorias" })
    }

    // Verificar que la sala existe
    const [cinemaRooms] = await pool.query("SELECT * FROM cinema_rooms WHERE id = ?", [id])

    if (cinemaRooms.length === 0) {
      return res.status(404).json({ message: "Sala de cine no encontrada" })
    }

    // Verificar si hay reservaciones para esta sala
    const [reservations] = await pool.query("SELECT * FROM reservations WHERE cinema_room_id = ?", [id])

    if (reservations.length > 0) {
      return res.status(400).json({
        message: "No se puede modificar la capacidad porque la sala tiene reservaciones",
      })
    }

    // Actualizar capacidad
    await pool.query("UPDATE cinema_rooms SET rows = ?, columns = ? WHERE id = ?", [rows, columns, id])

    res.status(200).json({
      message: "Capacidad de sala actualizada correctamente",
      cinemaRoom: {
        id: Number.parseInt(id),
        rows,
        columns,
      },
    })
  } catch (error) {
    console.error("Error al actualizar capacidad de sala:", error)
    res.status(500).json({ message: "Error interno del servidor" })
  }
}

module.exports = {
  createCinemaRoom,
  getAllCinemaRooms,
  getCinemaRoomById,
  updateCinemaRoomMovie,
  updateCinemaRoomCapacity,
}
