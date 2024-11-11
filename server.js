const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const path = require("path");
const { Storage } = require("@google-cloud/storage");
const fs = require("fs");
const { google } = require("googleapis");
const apikeys = require("./api.json");
const SCOPE = ["https://www.googleapis.com/auth/drive"];
const multer = require("multer");
const app = express();
// Configuración de CORS
const corsOptions = {
  origin: ["http://localhost:3000"],
  credentials: true,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  allowedHeaders: "Content-Type, Accept",
};

// Middleware para manejar CORS y datos
app.use(cors(corsOptions));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(express.json());

// Configuración de la base de datos
const dbOptions = {
  host: "database-1.cvg2mai4mclo.us-east-2.rds.amazonaws.com",
  user: "admin",
  password: "12345678",
  database: "marketplace",
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000, // Tiempo para dar por fallida la conexión
  keepAliveInitialDelay: 300000, // Mantiene vivas las conexiones cada 30 segundos
};


// Conexión con MySQL
const pool = mysql.createPool(dbOptions);

// Configuración de sesión utilizando MySQL para almacenar las sesiones
const sessionStore = new MySQLStore({}, pool);
async function authorize() {
  const jwtClient = new google.auth.JWT(
    apikeys.client_email,
    null,
    apikeys.private_key,
    SCOPE
  );
  await jwtClient.authorize();
  return jwtClient;
}
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Inicializar cliente de Google Cloud Storage
const storageClient = new Storage({ keyFilename: "./marketplace.json" });
const bucketName = "marketplace-agricola";

// Función para subir el archivo a Google Cloud Storage
async function uploadFileToGCS(buffer, fileName) {
  return new Promise((resolve, reject) => {
    const file = storageClient.bucket(bucketName).file(fileName);

    const stream = file.createWriteStream({
      resumable: false,
      public: true, // Hacer público el archivo para acceso público
      metadata: {
        contentType: "image/jpeg",
      },
    });

    stream.on("finish", () => {
      const fileUrl = `https://storage.googleapis.com/${bucketName}/${fileName}`;
      resolve(fileUrl);
    });

    stream.on("error", (error) => {
      reject(error);
    });

    // Enviar el búfer al stream de Google Cloud Storage
    stream.end(buffer);
  });
}

app.post("/SubirImagen", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("No se ha enviado ninguna imagen.");
    }

    // Generar el nombre de archivo con fecha y hora
    const fileName = `${Date.now()}_${req.file.originalname}`;

    // Subir la imagen a Google Cloud Storage usando el buffer en memoria
    const fileUrl = await uploadFileToGCS(req.file.buffer, fileName);

    // Responder con la URL de la imagen subida
    res.status(200).json({ url: fileUrl });
  } catch (error) {
    console.error("Error al subir la imagen:", error);
    res.status(500).json({ message: "Error al subir la imagen." });
  }
});
// Ruta para subir la imagen
app.post("/SubirImagen", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("No se ha enviado ninguna imagen.");
    }

    // Generar el nombre de archivo con fecha y hora
    const fileName = `${Date.now()}_${req.file.originalname}`;

    // Subir la imagen a Google Cloud Storage
    const fileUrl = await uploadFileToGCS(req.file.path, fileName);

    // Eliminar el archivo temporal después de subirlo
    fs.unlinkSync(req.file.path);

    // Responder con la URL de la imagen subida
    res.status(200).json({ url: fileUrl });
  } catch (error) {
    console.error("Error al subir la imagen:", error);
    res.status(500).json({ message: "Error al subir la imagen." });
  }
});

app.use(
  session({
    key: "session_cookie_name",
    secret: "session_cookie_secret",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24, // 1 día
    },
  })
);
// Endpoint para probar la conexión
app.get("/test-connection", async (req, res) => {
  try {
    const connection = await pool.getConnection();
    connection.release();
    res.status(200).json({ message: "Conexión exitosa a la base de datos" });
  } catch (error) {
    res.status(500).json({
      error: "Error al conectar a la base de datos",
      details: error.message,
    });
  }
});

async function reconnect() {
  try {
    await pool.getConnection();
    console.log("Conexión establecida con éxito.");
  } catch (error) {
    console.error("Error de conexión:", error);
    setTimeout(reconnect, 5000); // Intenta reconectar después de 5 segundos
  }
}

reconnect(); // Llama a esta función para iniciar el proceso de reconexión

// Endpoint para registrar un cliente
app.post("/Login", async (req, res) => {
  const { nickname, password } = req.body;

  console.log(`Received nickname: ${nickname}`);
  console.log(`Received password: ${password}`);

  try {
    const query = "SELECT * FROM usuarios WHERE nickname = ? AND pass = ?";
    const [results] = await pool.query(query, [nickname, password]);

    //  console.log(`Query executed: ${query}`);
    //    console.log(`Query results: ${JSON.stringify(results)}`);

    if (results.length > 0) {
      res.status(200).json({ message: "usuario valido", results });
    } else {
      res.status(401).json({ message: "Credenciales incorrectas" });
    }
  } catch (error) {
    console.error("Error al verificar las credenciales", error);
    res.status(500).json({
      error: "Error al verificar las credenciales",
      details: error.message,
    });
  }
});

app.post("/RegistrarCliente", async (req, res) => {
  const {
    nickname,
    pass,
    nombres,
    apellidoP,
    apellidoM,
    fechaN,
    correo,
    telefono,
  } = req.body;

  try {
    const query = `
      CALL RegistrarCliente(?, ?, ?, ?, ?, ?, ?, 0)
    `;
    const [results] = await pool.query(query, [
      nickname,
      pass,
      nombres,
      apellidoP,
      apellidoM,
      fechaN,
      correo,
      telefono,
    ]);
    res
      .status(200)
      .json({ message: "Cliente registrado exitosamente", results });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al registrar el cliente", details: error.message });
  }
});

app.get("/ObtenerPublicaciones", async (req, res) => {
  try {
    const query = "select * from publicaciones";
    const [results] = await pool.query(query);
    res.status(200).json({ message: "Publicaciones obtenidas", results });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al registrar el cliente", details: error.message });
  }
});
app.get("/BuscarPublicaciones", async (req, res) => {
  const { searchTerm } = req.query; // Recibe el término de búsqueda desde el frontend

  try {
    const query = `
      CALL BuscarPublicacionesPorNombre(?)
    `;
    const [results] = await pool.query(query, [searchTerm]);
    res.status(200).json({ message: "Publicaciones encontradas", results });
  } catch (error) {
    res.status(500).json({
      error: "Error al buscar publicaciones",
      details: error.message,
    });
  }
});

app.get("/ObtenerPublicacion", async (req, res) => {
  const { idPublicacion } = req.query;
  try {
    const query = "call Obtenerpublicacion(?)";
    const [results] = await pool.query(query, [idPublicacion]);
    res
      .status(200)
      .json({ message: "Cliente registrado exitosamente", results });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al registrar el cliente", details: error.message });
  }
});
app.get("/ObtenerMisPublicaciones", async (req, res) => {
  const { idUsuario } = req.query;
  try {
    const query = "SELECT * FROM publicaciones where idUsuario = ?";
    const [results] = await pool.query(query, [idUsuario]);
    res.status(200).json({ message: "Publicaciones obtenidas", results });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al registrar el cliente", details: error.message });
  }
});
// Endpoint para registrar un vendedor
app.post("/RegistrarVendedor", async (req, res) => {
  const {
    nickname,
    pass,
    nombres,
    apellidoP,
    apellidoM,
    fechaN,
    correo,
    telefono,
    calle,
    colonia,
    lote,
    municipio,
  } = req.body;

  try {
    const query = `
      CALL RegistrarVendedor(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const [results] = await pool.query(query, [
      nickname,
      pass,
      nombres,
      apellidoP,
      apellidoM,
      fechaN,
      correo,
      telefono,
      calle,
      colonia,
      lote,
      municipio,
    ]);
    res
      .status(200)
      .json({ message: "Vendedor registrado exitosamente", results });
  } catch (error) {
    res.status(500).json({
      error: "Error al registrar el vendedor",
      details: error.message,
    });
  }
});

// Endpoint para crear una publicación
app.post("/CrearPublicacion", async (req, res) => {
  const { nickname, nombre, precio, tunidad, cantidad, descripcion, foto } =
    req.body;

  try {
    const query = `
      CALL CrearPublicacion(?, ?, ?, ?, ?, ?, ?)
    `;
    const [results] = await pool.query(query, [
      nickname,
      nombre,
      precio,
      tunidad,
      cantidad,
      descripcion,
      foto,
    ]);
    res
      .status(200)
      .json({ message: "Publicación creada exitosamente", results });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al crear la publicación", details: error.message });
  }
});
// Endpoint para buscar publicaciones guardadas
app.get("/BuscarPublicacionesGuardadas", async (req, res) => {
  const { nickname } = req.query;

  try {
    const query = `
      CALL BuscarPublicacionesGuardadas(?)
    `;
    const [results] = await pool.query(query, [nickname]);
    res
      .status(200)
      .json({ message: "Publicaciones guardadas encontradas", results });
  } catch (error) {
    res.status(500).json({
      error: "Error al buscar publicaciones guardadas",
      details: error.message,
    });
  }
});

app.get("/ObtenerComentarios", async (req, res) => {
  const { idPublicacion } = req.query;

  try {
    const query = `
      CALL ObtenerComentarios(?)
    `;
    const [results] = await pool.query(query, [idPublicacion]);
    res.status(200).json({ message: "Comentarios obtenidos", results });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al obtener comentarios", details: error.message });
  }
});

app.get("/ComprobarGuardados", async (req, res) => {
  const { idPublicacion, nickname } = req.query;

  try {
    const query = `CALL ComprobarGuardados(?, ?)`;
    const [results] = await pool.query(query, [nickname, idPublicacion]);

    res.status(200).json({ message: "Comporbar guardado", results });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al obtener comentarios", details: error.message });
  }
});

app.delete("/EliminarPublicacion", async (req, res) => {
  const { nickname, idPublicacion } = req.query;

  try {
    const query = `
      CALL EliminarPublicacion(?, ?)
    `;
    const [results] = await pool.query(query, [nickname, idPublicacion]);
    res
      .status(200)
      .json({ message: "Publicación eliminada exitosamente", results });
  } catch (error) {
    res.status(500).json({
      error: "Error al eliminar la publicación",
      details: error.message,
    });
  }
});

app.post("/GuardarPublicacion", async (req, res) => {
  const { nickname, idPublicacion } = req.body;

  try {
    const query = `
      CALL GuardarPublicacion(?, ?)
    `;
    const [results] = await pool.query(query, [nickname, idPublicacion]);
    res
      .status(200)
      .json({ message: "Publicación guardada exitosamente", results });
  } catch (error) {
    res.status(500).json({
      error: "Error al guardar la publicación",
      details: error.message,
    });
  }
});
// Endpoint para comentar
app.post("/Comentar", async (req, res) => {
  const { nickname, idPublicacion, comentario } = req.body;

  try {
    const query = `
      CALL Comentar(?, ?, ?)
    `;
    const [results] = await pool.query(query, [
      idPublicacion,
      nickname,
      comentario,
    ]);
    res
      .status(200)
      .json({ message: "Comentario creado exitosamente", results });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al crear comentario", details: error.message });
  }
});

app.get("/obtenerUltimosMensajes", async (req, res) => {
  const { nickname } = req.query;
  try {
    const [rows] = await pool.query("CALL ObtenerUltimosMensajes(?)", [
      nickname,
    ]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener los últimos mensajes" });
  }
});

// Endpoint para EnviarMensaje
app.post("/enviarMensaje", async (req, res) => {
  const { nickname1, nickname2, mensaje } = req.body;
  try {
    await pool.query("CALL EnviarMensaje(?, ?, ?)", [
      nickname1,
      nickname2,
      mensaje,
    ]);
    res.status(200).json({ message: "Mensaje enviado correctamente" });
  } catch (error) {
    res.status(500).json({ error: "Error al enviar el mensaje" });
  }
});

// Endpoint para ObtenerConversacion
app.get("/obtenerConversacion", async (req, res) => {
  const { nickname1, nickname2 } = req.query;
  try {
    const [rows] = await pool.query("CALL ObtenerConversacion(?, ?)", [
      nickname1,
      nickname2,
    ]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener la conversación" });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
