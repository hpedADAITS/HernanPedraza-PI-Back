#  SyncRekuest Backend

**SyncRekuest** es una plataforma que conecta a DJs y asistentes, permitiendo sugerencias y votaciones musicales en tiempo real.
Este repositorio contiene el **backend**, construido con **Node.js + Express**, con soporte para **WebSockets (Socket.IO)** y base de datos **MongoDB**.

---

##  Tecnologías principales

* **Node.js + Express** → API REST rápida y modular.
* **Socket.IO** → comunicación en tiempo real.
* **MongoDB + Mongoose** → base de datos flexible y escalable.
* **JWT (JSON Web Tokens)** → autenticación segura.
* **Helmet + Rate Limit** → protección frente a ataques comunes.
* **Docker (opcional)** → despliegue y escalado sencillo.

---

##  Instalación

```bash
# Clonar el repositorio
git clone https://github.com/tuusuario/syncrekuest-backend.git
cd syncrekuest-backend

# Instalar dependencias
npm install

# Iniciar servidor en modo desarrollo
npm run dev
```

El servidor se ejecutará en [http://localhost:4000](http://localhost:4000).

---

##  Estructura básica

```
src/
 ├── routes/        # Definición de endpoints (auth, users, songs, events)
 ├── controllers/   # Lógica de negocio
 ├── models/        # Esquemas Mongoose
 ├── sockets/       # Eventos WebSocket
 ├── middleware/    # Autenticación, validaciones, seguridad
 ├── config/        # Variables de entorno, conexión DB
 └── server.js      # Punto de entrada principal
```

---

##  Configuración

Crea un archivo `.env` en la raíz del proyecto con las siguientes variables:

```
PORT=4000
MONGO_URI=mongodb+srv://usuario:password@cluster.mongodb.net/syncrekuest
JWT_SECRET=tu_clave_segura
CORS_ORIGIN=http://localhost:5173
```

---

##  Endpoints principales

| Método | Ruta               | Descripción                                    |
| ------ | ------------------ | ---------------------------------------------- |
| POST   | /api/auth/register | Registro de usuario                            |
| POST   | /api/auth/login    | Inicio de sesión                               |
| GET    | /api/songs         | Listado de canciones                           |
| POST   | /api/votes         | Registrar voto                                 |
| WS     | /socket.io         | Canal en tiempo real para eventos y votaciones |

---

##  Scripts útiles

```bash
npm run dev     # Ejecuta con nodemon
npm run start   # Ejecuta en producción
```

---

##  Seguridad y buenas prácticas

* **Helmet** para cabeceras HTTP seguras.
* **Rate limiting** para evitar spam de peticiones.
* **JWT** para autenticación basada en tokens.
* **Validaciones** en cada endpoint y middleware.

---

##  Conexión con el frontend

El frontend (React + Vite) se comunica con este backend mediante:

* **REST (HTTPS)** → autenticación, usuarios, canciones.
* **WebSockets** → votaciones y actualizaciones en tiempo real.

---

## 🐳 Despliegue con Docker (opcional)

```bash
docker build -t syncrekuest-backend .
docker run -p 4000:4000 syncrekuest-backend
```

---

