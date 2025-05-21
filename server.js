const express = require("express")
const cors = require("cors")
const morgan = require("morgan")
const path = require("path")
const { connectDB } = require("./db")
require("dotenv").config()

// Importar rutas
const authRoutes = require("./routes/auth.routes")
const userRoutes = require("./routes/user.routes")
const cinemaRoutes = require("./routes/cinema.routes")
const reservationRoutes = require("./routes/reservation.routes")

const app = express()
const PORT = process.env.PORT || 3000

// Middlewares
app.use(cors())
app.use(morgan("dev"))
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use("/uploads", express.static(path.join(__dirname, "uploads")))

// Rutas
app.use("/api/auth", authRoutes)
app.use("/api/users", userRoutes)
app.use("/api/cinemas", cinemaRoutes)
app.use("/api/reservations", reservationRoutes)

// Ruta de prueba
app.get("/", (req, res) => {
  res.json({ message: "API de Cinema Project funcionando correctamente" })
})

// Iniciar servidor
const startServer = async () => {
  try {
    await connectDB()
    app.listen(PORT, () => {
      console.log(`Servidor corriendo en el puerto ${PORT}`)
    })
  } catch (error) {
    console.error("Error al iniciar el servidor:", error)
  }
}

startServer()
