# Diagramas de Secuencia Backend - SyncRekuest

**Enfoque**: Solo lógica interna del servidor (sin mensajes del frontend)

---

## 1. Secuencia de Inicio de Sesión (Perspectiva Backend)

Muestra solo el flujo interno del servidor cuando un usuario se autentica.

```plantuml
@startuml
participant "Solicitud HTTP\n(POST /api/auth/login)" as Request
participant "AuthController" as Controller
participant "AuthService" as Service
participant "UserRepository" as UserRepo
database "MongoDB" as DB
participant "JWTUtil" as JWT
participant "Respuesta HTTP" as Response

Request -> Controller: {email, password}
activate Controller

Controller -> Controller: Extraer credenciales
Controller -> Service: login(email, password)
activate Service

Service -> UserRepo: findByEmail(email)
activate UserRepo

UserRepo -> DB: Consultar usuarios\ndonde email = email
activate DB
DB --> UserRepo: Documento de usuario\n(con contraseña hasheada)
deactivate DB

deactivate UserRepo

Service -> Service: Validar\nhash de contraseña\ncon bcryptjs

alt La contraseña coincide
  Service -> JWT: generateToken(userId, role)
  activate JWT
  JWT -> JWT: Crear payload JWT
  JWT -> JWT: Firmar con secreto
  JWT --> Service: token
  deactivate JWT
  
  Service --> Controller: {user, token, expiresIn}
  deactivate Service
  
  Controller -> Response: 200 OK\n{success, user, token, expiresIn}
  
else La contraseña es inválida
  Service --> Controller: throw UnauthorizedError
  deactivate Service
  
  Controller -> Response: 401 No Autorizado\n{error: "Credenciales inválidas"}
end

deactivate Controller
@enduml
```

![Secuencia de Inicio de Sesión Backend](../../diagrams/sequence-backend_diagram_1.png)

### Responsabilidades Backend
Validar que usuario existe
Comparación de hash de contraseña
Generar token JWT
Devolver resultado de autenticación

### Operaciones de Base de Datos
- Consultar usuarios por email
- Sin operaciones de escritura

### Posibles Errores
- Usuario no encontrado (401)
- Contraseña inválida (401)
- Error de base de datos (500)

---

## 2. Secuencia de Sugerir Canción (Perspectiva Backend)

Muestra flujo interno del servidor cuando se sugiere una canción.

```plantuml
@startuml
participant "Solicitud HTTP\n(POST /api/songs/suggestions)" as Request
participant "SongController" as Controller
participant "SongService" as Service
participant "EventRepository" as EventRepo
participant "SongRepository" as SongRepo
database "MongoDB" as DB
participant "SocketService" as SocketSvc
participant "Puerta de Socket.IO" as SocketGW
participant "Respuesta HTTP" as Response

Request -> Controller: {eventId, title, artist}\n+ JWT (userId)
activate Controller

Controller -> Controller: Extraer JWT\nobtener userId
Controller -> Controller: Validar entrada\n(título, artista no vacíos)

alt La validación falla
  Controller -> Response: 400 Solicitud Incorrecta
else La validación pasa
  Controller -> Service: suggestSong(\neventId, userId,\ntitle, artist)
  activate Service
  
  Service -> EventRepo: findById(eventId)
  activate EventRepo
  EventRepo -> DB: Consultar eventos\ndonde _id = eventId
  DB --> EventRepo: Documento de evento
  deactivate EventRepo
  
  Service -> Service: Validar\nevento.status == 'ACTIVE'
  Service -> Service: Verificar\nlímite de sugerencias del usuario
  
  alt Evento no encontrado
    Service --> Controller: throw NotFoundError
    Controller -> Response: 404 No Encontrado
  else Evento cerrado
    Service --> Controller: throw BadRequestError
    Controller -> Response: 400 El evento está cerrado
  else Límite de sugerencias excedido
    Service --> Controller: throw BadRequestError
    Controller -> Response: 400 Límite de sugerencias excedido
  else Todas las verificaciones pasan
    Service -> SongRepo: create({\neventId, userId,\ntitle, artist,\nstatus: 'PENDING'})\n
    activate SongRepo
    SongRepo -> DB: Insertar documento de canción
    DB --> SongRepo: Canción creada con _id
    deactivate SongRepo
    
    Service -> SocketSvc: notifyDJNewSuggestion(\neventId, song)
    activate SocketSvc
    
    SocketSvc -> SocketGW: Emitir al DJ\n'song_suggested'\n{eventId, song}
    activate SocketGW
    SocketGW -> SocketGW: Encontrar socket del DJ\nen sala del evento
    SocketGW -> SocketGW: Emitir evento\nal cliente del DJ
    deactivate SocketGW
    
    deactivate SocketSvc
    
    Service --> Controller: {song, message}
    deactivate Service
    
    Controller -> Response: 201 Creado\n{success, song, message}
  end
end

deactivate Controller
@enduml
```

![Secuencia de Sugerir Canción Backend](../../diagrams/sequence-backend_diagram_2.png)

### Responsabilidades Backend
Validar que evento existe y está activo
Verificar límite de sugerencias
Crear registro de canción con estado PENDING
Notificar al DJ vía Socket.IO
Devolver canción creada

### Operaciones de Base de Datos
- Consultar evento por ID
- Insertar documento de canción

### Eventos de Socket Emitidos
- `song_suggested` → cliente del DJ

### Posibles Errores
- Evento no encontrado (404)
- Evento está cerrado (400)
- Límite de sugerencias excedido (400)
- Entrada inválida (400)

---

## 3. Secuencia de Voto de Canción (Perspectiva Backend)

Muestra flujo interno del servidor cuando se emite un voto y se emite.

```plantuml
@startuml
participant "Solicitud HTTP\n(POST /api/votes)" as Request
participant "VoteController" as Controller
participant "VoteService" as Service
participant "SongRepository" as SongRepo
participant "VoteRepository" as VoteRepo
database "MongoDB" as DB
participant "SocketService" as SocketSvc
participant "Puerta de Socket.IO" as SocketGW
participant "Respuesta HTTP" as Response

Request -> Controller: {eventId, songId, value: 1}\n+ JWT (userId)
activate Controller

Controller -> Controller: Extraer JWT\nobtener userId
Controller -> Controller: Validar entrada\n(songId, value válidos)

alt La validación falla
  Controller -> Response: 400 Solicitud Incorrecta
else La validación pasa
  Controller -> Service: castVote(\neventId, songId,\nuserId, value)
  activate Service
  
  Service -> SongRepo: findById(songId)
  activate SongRepo
  SongRepo -> DB: Consultar canciones\ndonde _id = songId
  DB --> SongRepo: Documento de canción
  deactivate SongRepo
  
  Service -> Service: Validar\nestado de canción en\n['APPROVED', 'PLAYING']
  Service -> Service: Verificar que evento\nSigue siendo ACTIVE
  
  Service -> VoteRepo: findByUserAndSong(\nuserId, songId)
  activate VoteRepo
  VoteRepo -> DB: Consultar votos\ndonde userId=userId\nY songId=songId
  DB --> VoteRepo: Voto existente o nulo
  deactivate VoteRepo
  
  alt Canción no encontrada
    Service --> Controller: throw NotFoundError
    Controller -> Response: 404 Canción no encontrada
  else Canción no aprobada
    Service --> Controller: throw BadRequestError
    Controller -> Response: 400 Votación de canción cerrada
  else Ya votó
    Service -> VoteRepo: updateVote(...)
    activate VoteRepo
    VoteRepo -> DB: Actualizar voto\ndonde _id = voteId
    DB --> VoteRepo: Voto actualizado
    deactivate VoteRepo
  else Primera vez votando
    Service -> VoteRepo: create({\neventId, songId,\nuserId, value})
    activate VoteRepo
    VoteRepo -> DB: Insertar documento de voto
    DB --> VoteRepo: Voto creado
    deactivate VoteRepo
  end
  
  Service -> VoteRepo: countBySong(songId)
  activate VoteRepo
  VoteRepo -> DB: Agregar votos\ndonde songId = songId
  DB --> VoteRepo: totalVotes: número
  deactivate VoteRepo
  
  Service -> SocketSvc: broadcastVoteUpdate(\neventId, songId,\ntotalVotes)
  activate SocketSvc
  
  SocketSvc -> SocketGW: Emitir a sala\n'votes_updated'\n{songId, totalVotes, timestamp}
  activate SocketGW
  SocketGW -> SocketGW: Encontrar todos los usuarios\nen sala del evento
  SocketGW -> SocketGW: Emitir a todos los sockets
  deactivate SocketGW
  
  deactivate SocketSvc
  
  Service --> Controller: {songId, totalVotes}
  deactivate Service
  
  Controller -> Response: 200 OK\n{success, songId, totalVotes}
end

deactivate Controller
@enduml
```

![Secuencia de Voto de Canción Backend](../../diagrams/sequence-backend_diagram_3.png)

### Responsabilidades Backend
Validar que canción existe y es votable
Verificar si usuario ya votó
Crear o actualizar registro de voto
Calcular votos totales para canción
Emitir a todos los clientes vía Socket.IO
Devolver nuevo conteo de votos

### Operaciones de Base de Datos
- Consultar canción por ID
- Consultar voto existente por usuario + canción
- Insertar nuevo voto O actualizar voto existente
- Agregar votos por canción

### Eventos de Socket Emitidos
- `votes_updated` → Todos los usuarios en sala del evento

### Posibles Errores
- Canción no encontrada (404)
- Votación de canción cerrada (400)
- Valor de voto inválido (400)

---

## 4. Secuencia de Crear Evento (Perspectiva Backend)

Muestra flujo interno del servidor cuando un DJ crea un evento.

```plantuml
@startuml
participant "Solicitud HTTP\n(POST /api/events)" as Request
participant "EventController" as Controller
participant "EventService" as Service
participant "EventRepository" as EventRepo
database "MongoDB" as DB
participant "CodeGen" as CodeGen
participant "QRGen" as QRGen
participant "Respuesta HTTP" as Response

Request -> Controller: {name, location,\nstartTime, settings}\n+ JWT (userId, role=DJ)
activate Controller

Controller -> Controller: Extraer JWT\nobtener userId
Controller -> Controller: Validar entrada\n(name, startTime, etc.)
Controller -> Controller: Verificar rol del usuario\n== 'DJ'

alt La autorización falla
  Controller -> Response: 403 Prohibido\nEl usuario no es DJ
else La validación falla
  Controller -> Response: 400 Solicitud Incorrecta
else Todas las validaciones pasan
  Controller -> Service: createEvent(\neventData, djId)
  activate Service
  
  Service -> CodeGen: generateCode()
  activate CodeGen
  CodeGen -> CodeGen: Generar 6 caracteres\nuppercase alphanum
  CodeGen -> CodeGen: Asegurar unicidad\nlaza de verificación
  CodeGen --> Service: code (por ejemplo, "ABCD12")
  deactivate CodeGen
  
  Service -> QRGen: generateQR(code)
  activate QRGen
  QRGen -> QRGen: Crear imagen QR\ndel código de evento
  QRGen -> QRGen: Guardar en almacenamiento\no generar URL
  QRGen --> Service: qrUrl
  deactivate QRGen
  
  Service -> EventRepo: create({\nname, code, djId,\nstatus: 'ACTIVE',\nsettings, startTime,\nlocation})
  activate EventRepo
  
  EventRepo -> DB: Insertar documento de evento\ncon código generado
  activate DB
  DB --> EventRepo: Evento creado con _id
  deactivate DB
  
  deactivate EventRepo
  
  Service -> Service: Construir respuesta\ncon código, qrUrl
  
  Service --> Controller: {event, code, qrUrl}
  deactivate Service
  
  Controller -> Response: 201 Creado\n{success, event,\ncode, qrUrl}
end

deactivate Controller
@enduml
```

![Secuencia de Crear Evento Backend](../../diagrams/sequence-backend_diagram_4.png)

### Responsabilidades Backend
Validar JWT y rol de DJ
Validar datos del evento
Generar código único de 6 caracteres
Generar imagen de código QR
Crear registro de evento en base de datos
Devolver evento con código y QR

### Operaciones de Base de Datos
- Insertar documento de evento con código único

### Utilidades Utilizadas
- Generador de código (unicidad garantizada)
- Generador de QR

### Posibles Errores
- Usuario no es DJ (403)
- Entrada inválida (400)
- Generación de código falló (500)
- Generación de QR falló (500)

---

## 5. Secuencia de Cerrar Evento (Perspectiva Backend)

Muestra flujo interno del servidor cuando un DJ cierra un evento.

```plantuml
@startuml
participant "Solicitud HTTP\n(POST /api/events/:eventId/close)" as Request
participant "EventController" as Controller
participant "EventService" as Service
participant "EventRepository" as EventRepo
participant "VoteService" as VoteService
database "MongoDB" as DB
participant "SocketService" as SocketSvc
participant "Puerta de Socket.IO" as SocketGW
participant "Respuesta HTTP" as Response

Request -> Controller: {eventId}\n+ JWT (userId)
activate Controller

Controller -> Controller: Extraer JWT\nobtener userId
Controller -> Service: closeEvent(eventId, userId)
activate Service

Service -> EventRepo: findById(eventId)
activate EventRepo
EventRepo -> DB: Consultar eventos\ndonde _id = eventId
DB --> EventRepo: Documento de evento
deactivate EventRepo

Service -> Service: Verificar\nuserId == event.djId
Service -> Service: Verificar que evento es\nstatus = 'ACTIVE'

alt Evento no encontrado
  Service --> Controller: throw NotFoundError
  Controller -> Response: 404 No Encontrado
else Usuario no es DJ
  Service --> Controller: throw ForbiddenError
  Controller -> Response: 403 Prohibido
else Evento ya cerrado
  Service --> Controller: throw BadRequestError
  Controller -> Response: 400 El evento ya está cerrado
else La autorización pasa
  Service -> EventRepo: update(eventId,\n{status: 'CLOSED',\nendTime: now})
  activate EventRepo
  EventRepo -> DB: Actualizar evento\nestablecer status = CLOSED
  DB --> EventRepo: Evento actualizado
  deactivate EventRepo
  
  Service -> VoteService: getVoteStats(eventId)
  activate VoteService
  VoteService -> DB: Agregar votos\ny canciones para evento
  DB --> VoteService: stats
  deactivate VoteService
  
  Service -> SocketSvc: closeEventRoom(eventId)
  activate SocketSvc
  
  SocketSvc -> SocketGW: Emitir a sala\n'event_closed'\n{eventId, finalStats,\ntimestamp}
  activate SocketGW
  SocketGW -> SocketGW: Encontrar todos los usuarios\nen sala del evento
  SocketGW -> SocketGW: Emitir evento a todos
  SocketGW -> SocketGW: Desconectar oyentes\nde la sala Socket
  deactivate SocketGW
  
  deactivate SocketSvc
  
  Service --> Controller: {event, finalStats}
  deactivate Service
  
  Controller -> Response: 200 OK\n{success, message,\nevent, finalStats}
end

deactivate Controller
@enduml
```

![Secuencia de Cerrar Evento Backend](../../diagrams/sequence-backend_diagram_5.png)

### Responsabilidades Backend
Verificar JWT y propiedad del DJ
Verificar que evento está activo
Actualizar estado del evento a CLOSED
Calcular estadísticas finales
Emitir event_closed a todos los participantes
Desconectar todos los oyentes Socket.IO

### Operaciones de Base de Datos
- Consultar evento por ID
- Actualizar estado del evento a CLOSED
- Agregar votos y canciones para estadísticas

### Eventos de Socket Emitidos
- `event_closed` → Todos los usuarios en sala del evento

### Posibles Errores
- Evento no encontrado (404)
- Usuario no es DJ (403)
- Evento ya cerrado (400)

---

## 6. Secuencia de Aprobar Canción (Perspectiva Backend)

Muestra DJ aprobando una canción sugerida para la cola.

```plantuml
@startuml
participant "Solicitud HTTP\n(POST /api/events/:eventId/songs/:songId/approve)" as Request
participant "SongController" as Controller
participant "SongService" as Service
participant "SongRepository" as SongRepo
database "MongoDB" as DB
participant "SocketService" as SocketSvc
participant "Puerta de Socket.IO" as SocketGW
participant "Respuesta HTTP" as Response

Request -> Controller: {eventId, songId}\n+ JWT (userId)
activate Controller

Controller -> Controller: Extraer JWT\nobtener userId
Controller -> Service: approveSong(\neventId, songId, userId)
activate Service

Service -> SongRepo: findById(songId)
activate SongRepo
SongRepo -> DB: Consultar canciones\ndonde _id = songId
DB --> SongRepo: Documento de canción
deactivate SongRepo

Service -> Service: Verificar\nsong.eventId == eventId
Service -> Service: Verificar\nusuario es DJ\ndel evento
Service -> Service: Verificar\nestado de canción == 'PENDING'

alt Canción no encontrada
  Service --> Controller: throw NotFoundError
  Controller -> Response: 404 Canción no encontrada
else Canción no pendiente
  Service --> Controller: throw BadRequestError
  Controller -> Response: 400 La canción no está pendiente
else Usuario no es DJ
  Service --> Controller: throw ForbiddenError
  Controller -> Response: 403 Prohibido
else Todas las verificaciones pasan
  Service -> SongRepo: updateStatus(songId,\n'APPROVED')
  activate SongRepo
  SongRepo -> DB: Actualizar canción\nestablecer status = APPROVED
  DB --> SongRepo: Canción actualizada
  deactivate SongRepo
  
  Service -> SocketSvc: broadcastQueueUpdate(eventId)
  activate SocketSvc
  
  SocketSvc -> SocketGW: Emitir a sala\n'queue_updated'\n{queue, timestamp}
  activate SocketGW
  SocketGW -> SocketGW: Obtener cola actualizada\nde la BD
  SocketGW -> SocketGW: Emitir a todos en la sala
  deactivate SocketGW
  
  deactivate SocketSvc
  
  Service --> Controller: {song, queue}
  deactivate Service
  
  Controller -> Response: 200 OK\n{success, song,\nupdatedQueue}
end

deactivate Controller
@enduml
```

![Secuencia de Aprobar Canción Backend](../../diagrams/sequence-backend_diagram_6.png)

### Responsabilidades Backend
Verificar propiedad del DJ
Verificar que canción existe y está pendiente
Actualizar estado de canción a APPROVED
Emitir actualización de cola a todos los participantes

### Operaciones de Base de Datos
- Consultar canción por ID
- Actualizar estado de canción

### Eventos de Socket Emitidos
- `queue_updated` → Todos los usuarios en sala del evento

### Posibles Errores
- Canción no encontrada (404)
- Canción no pendiente (400)
- Usuario no es DJ (403)

---

## 7. Secuencia de Aprobar Evento + Unirse a Sala (Perspectiva Backend)

Muestra flujo completo cuando un participante se une a un evento.

```plantuml
@startuml
participant "Conexión Socket.IO" as SocketConnect
participant "Puerta de Socket.IO" as SocketGW
participant "EventRepository" as EventRepo
database "MongoDB" as DB
participant "ParticipantRepository" as ParticipantRepo
participant "SongRepository" as SongRepo
participant "Eventos de Cliente Socket.IO" as SocketClient

SocketConnect -> SocketGW: socket.emit('join_event',\n{eventCode, token})
activate SocketGW

SocketGW -> SocketGW: Extraer token JWT\nobtener userId
SocketGW -> EventRepo: findByCode(eventCode)
activate EventRepo
EventRepo -> DB: Consultar eventos\ndonde code = eventCode
DB --> EventRepo: Documento de evento
deactivate EventRepo

alt Evento no encontrado
  SocketGW -> SocketClient: emit('error',\n'Evento no encontrado')
else Evento está cerrado
  SocketGW -> SocketClient: emit('error',\n'El evento está cerrado')
else Evento encontrado y activo
  SocketGW -> SocketGW: Unirse socket a sala\n`event:${eventId}`
  
  SocketGW -> ParticipantRepo: addParticipant(\neventId, userId)
  activate ParticipantRepo
  ParticipantRepo -> DB: Insertar documento de participante
  DB --> ParticipantRepo: Creado
  deactivate ParticipantRepo
  
  SocketGW -> ParticipantRepo: countByEvent(eventId)
  activate ParticipantRepo
  ParticipantRepo -> DB: Contar participantes\ndonde eventId=eventId
  DB --> ParticipantRepo: count
  deactivate ParticipantRepo
  
  SocketGW -> SongRepo: findByEvent(eventId,\nstatus='APPROVED')
  activate SongRepo
  SongRepo -> DB: Consultar canciones\ndonde eventId=eventId\nY status='APPROVED'
  DB --> SongRepo: Matriz de cola
  deactivate SongRepo
  
  SocketGW -> SocketClient: emit('joined',\n{event, queue,\nparticipantCount})
  
  SocketGW -> SocketGW: Emitir a la sala
  SocketGW -> SocketGW: Emitir 'participant_joined'\na todos en la sala
  
end

deactivate SocketGW
@enduml
```

![Secuencia de Unirse a Evento Backend](../../diagrams/sequence-backend_diagram_7.png)

### Responsabilidades Backend
Verificar token JWT
Encontrar evento por código
Verificar que evento está activo
Agregar registro de participante
Obtener cola actual
Enviar datos iniciales al usuario que se une
Emitir actualización de conteo de participantes

### Operaciones de Base de Datos
- Consultar evento por código
- Insertar registro de participante
- Contar participantes
- Consultar canciones aprobadas

### Eventos de Socket Emitidos
- `joined` → Usuario que se une
- `participant_joined` → Todos en sala del evento

### Posibles Errores
- Evento no encontrado (error de socket)
- Evento está cerrado (error de socket)
- Token inválido (error de socket)

---

## Resumen: Patrón de Flujo de Solicitud

Todas las secuencias de backend siguen este patrón:

```
1. Solicitud HTTP / Evento de Socket llega
   ↓
2. Middleware: Validar token JWT
   ↓
3. Controller: Extraer y validar entrada
   ↓
4. Service: Ejecutar lógica de negocio
   ↓
5. Repository: Consultar/mutar base de datos
   ↓
6. Service: Calcular respuesta
   ↓
7. SocketService: Emitir actualizaciones si es necesario
   ↓
8. Controller: Devolver respuesta HTTP / Respuesta de Socket
```

---

## Patrones Clave de Backend

Autenticación Basada en JWT - Cada solicitud validada
Patrón de Repository - Abstracción de base de datos
Capa de Service - Lógica de negocio centralizada
Emisión de Socket - Actualizaciones en tiempo real a todos los usuarios conectados
Operaciones Seguras de Transacción - Consistencia de base de datos
Propagación de Errores - Los errores fluyen desde Repository → Service → Controller

---

Este documento se enfoca en **flujos internos de Backend**. Para secuencias de extremo a extremo que incluyen participación del Frontend, consulte `docs/sequence-global_ES.md`.
