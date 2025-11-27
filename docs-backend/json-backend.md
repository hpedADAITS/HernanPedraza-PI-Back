# Estructuras JSON Backend - SyncRekuest

**Enfoque**: JSON producido y consumido por Backend (respuestas de API, esquemas de base de datos, eventos de socket)

---

## 1. Respuestas de Autenticación

### Respuesta de Inicio de Sesión

```plantuml
@startuml json
{
  "success": true,
  "data": {
    "token": "[REDACTED:jwt-token]SIGNATURE",
    "user": {
      "id": "665f9b4b8f96e2f9451e713d",
      "name": "Juan DJ",
      "email": "dj@example.com",
      "role": "DJ"
    },
    "expiresIn": 86400
  },
  "message": "Inicio de sesión exitoso"
}
@enduml
```

### Respuesta de Registro

```plantuml
@startuml json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "665f9b4b8f96e2f9451e7140",
      "name": "Ana García",
      "email": "ana@example.com",
      "role": "ATTENDEE"
    },
    "expiresIn": 86400
  },
  "message": "Cuenta creada con éxito"
}
@enduml
```

### Respuestas de Error

#### Credenciales Inválidas
```plantuml
@startuml json
{
  "success": false,
  "error": {
    "code": "AUTH_001",
    "message": "Email o contraseña inválido"
  },
  "statusCode": 401
}
@enduml
```

#### El Usuario Ya Existe
```plantuml
@startuml json
{
  "success": false,
  "error": {
    "code": "AUTH_002",
    "message": "Email ya registrado"
  },
  "statusCode": 400
}
@enduml
```

---

## 2. Respuestas de Eventos

### Respuesta de Crear Evento

```plantuml
@startuml json
{
  "success": true,
  "data": {
    "id": "6660b1fa24a10f0a8b3d9abc",
    "name": "Fiesta Fin de Exámenes",
    "code": "ABCD12",
    "djId": "665f9b4b8f96e2f9451e713d",
    "djName": "Juan DJ",
    "status": "ACTIVE",
    "location": "Bar Central",
    "startTime": "2025-06-20T22:00:00Z",
    "endTime": null,
    "settings": {
      "votingEnabled": true,
      "maxSuggestionsPerUser": 3,
      "allowAnonymous": false
    },
    "qrUrl": "https://api.syncrekuest.com/qr/ABCD12.png",
    "createdAt": "2025-06-20T12:00:00Z",
    "updatedAt": "2025-06-20T12:00:00Z"
  },
  "message": "Evento creado con éxito"
}
@enduml
```

### Respuesta de Detalles del Evento

```plantuml
@startuml json
{
  "success": true,
  "data": {
    "id": "6660b1fa24a10f0a8b3d9abc",
    "name": "Fiesta Fin de Exámenes",
    "code": "ABCD12",
    "djId": "665f9b4b8f96e2f9451e713d",
    "djName": "Juan DJ",
    "status": "ACTIVE",
    "location": "Bar Central",
    "startTime": "2025-06-20T22:00:00Z",
    "endTime": null,
    "settings": {
      "votingEnabled": true,
      "maxSuggestionsPerUser": 3,
      "allowAnonymous": false
    },
    "participantCount": 42,
    "stats": {
      "totalSuggestions": 18,
      "totalVotes": 156,
      "topSong": {
        "id": "6660b3bc24a10f0a8b3d9ac0",
        "title": "Billie Jean",
        "artist": "Michael Jackson",
        "votes": 18
      }
    },
    "qrUrl": "https://api.syncrekuest.com/qr/ABCD12.png"
  }
}
@enduml
```

### Respuesta de Lista de Eventos (Paginada)

```plantuml
@startuml json
{
  "success": true,
  "data": [
    {
      "id": "6660b1fa24a10f0a8b3d9abc",
      "name": "Fiesta Fin de Exámenes",
      "code": "ABCD12",
      "djName": "Juan DJ",
      "status": "ACTIVE",
      "location": "Bar Central",
      "startTime": "2025-06-20T22:00:00Z",
      "participantCount": 42
    },
    {
      "id": "6660b1fa24a10f0a8b3d9abd",
      "name": "After Party",
      "code": "XYZ789",
      "djName": "María Mix",
      "status": "ACTIVE",
      "location": "Club Neon",
      "startTime": "2025-06-21T02:00:00Z",
      "participantCount": 28
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 42,
    "pages": 5
  }
}
@enduml
```

### Error Evento No Encontrado

```plantuml
@startuml json
{
  "success": false,
  "error": {
    "code": "EVENT_001",
    "message": "Evento no encontrado"
  },
  "statusCode": 404
}
@enduml
```

### Error Evento Cerrado

```plantuml
@startuml json
{
  "success": false,
  "error": {
    "code": "EVENT_002",
    "message": "El evento está cerrado"
  },
  "statusCode": 400
}
@enduml
```

---

## 3. Respuestas de Canciones

### Solicitud de Sugerir Canción (Backend recibe)

```plantuml
@startuml json
{
  "eventId": "6660b1fa24a10f0a8b3d9abc",
  "title": "Billie Jean",
  "artist": "Michael Jackson"
}
@enduml
```

### Respuesta de Sugerir Canción

```plantuml
@startuml json
{
  "success": true,
  "data": {
    "id": "6660b3bc24a10f0a8b3d9ac5",
    "eventId": "6660b1fa24a10f0a8b3d9abc",
    "title": "Billie Jean",
    "artist": "Michael Jackson",
    "status": "PENDING",
    "suggestedBy": "665f9c218f96e2f9451e7140",
    "suggestedByName": "Ana García",
    "createdAt": "2025-06-20T21:05:30Z"
  },
  "message": "Sugerencia de canción enviada"
}
@enduml
```

### Respuesta de Cola de Eventos (Canciones Aprobadas)

```plantuml
@startuml json
{
  "success": true,
  "data": {
    "eventId": "6660b1fa24a10f0a8b3d9abc",
    "queue": [
      {
        "id": "6660b3bc24a10f0a8b3d9ac0",
        "title": "Billie Jean",
        "artist": "Michael Jackson",
        "status": "APPROVED",
        "votes": {
          "total": 18,
          "byUser": 1
        },
        "suggestedBy": "Ana García",
        "position": 1,
        "createdAt": "2025-06-20T20:00:00Z"
      },
      {
        "id": "6660b3bc24a10f0a8b3d9ac1",
        "title": "Thriller",
        "artist": "Michael Jackson",
        "status": "APPROVED",
        "votes": {
          "total": 15,
          "byUser": 0
        },
        "suggestedBy": "Carlos Ruiz",
        "position": 2,
        "createdAt": "2025-06-20T20:15:00Z"
      }
    ]
  }
}
@enduml
```

### Respuesta de Aprobar Canción

```plantuml
@startuml json
{
  "success": true,
  "data": {
    "song": {
      "id": "6660b3bc24a10f0a8b3d9ac5",
      "title": "Billie Jean",
      "artist": "Michael Jackson",
      "status": "APPROVED",
      "approvedAt": "2025-06-20T21:10:00Z"
    },
    "queue": [
      {
        "id": "6660b3bc24a10f0a8b3d9ac0",
        "title": "Billie Jean",
        "artist": "Michael Jackson",
        "votes": 18,
        "position": 1
      }
    ]
  },
  "message": "Canción aprobada y agregada a la cola"
}
@enduml
```

### Error Límite de Sugerencias Excedido

```plantuml
@startuml json
{
  "success": false,
  "error": {
    "code": "SONG_001",
    "message": "Ha alcanzado su límite de sugerencias de canciones para este evento"
  },
  "statusCode": 400
}
@enduml
```

---

## 4. Respuestas de Votos

### Solicitud de Emitir Voto (Backend recibe)

```plantuml
@startuml json
{
  "eventId": "6660b1fa24a10f0a8b3d9abc",
  "songId": "6660b3bc24a10f0a8b3d9ac0",
  "value": 1
}
@enduml
```

### Respuesta de Emitir Voto

```plantuml
@startuml json
{
  "success": true,
  "data": {
    "songId": "6660b3bc24a10f0a8b3d9ac0",
    "totalVotes": 19,
    "userVoteValue": 1,
    "timestamp": "2025-06-20T21:35:22Z"
  },
  "message": "Voto registrado"
}
@enduml
```

### Error Ya Votó

```plantuml
@startuml json
{
  "success": false,
  "error": {
    "code": "VOTE_001",
    "message": "Ya ha votado por esta canción"
  },
  "statusCode": 409
}
@enduml
```

### Respuesta de Estadísticas de Votos

```plantuml
@startuml json
{
  "success": true,
  "data": {
    "eventId": "6660b1fa24a10f0a8b3d9abc",
    "stats": {
      "totalVotes": 156,
      "averageVotesPerSong": 8.7,
      "topSongs": [
        {
          "id": "6660b3bc24a10f0a8b3d9ac0",
          "title": "Billie Jean",
          "artist": "Michael Jackson",
          "votes": 18
        },
        {
          "id": "6660b3bc24a10f0a8b3d9ac1",
          "title": "Thriller",
          "artist": "Michael Jackson",
          "votes": 15
        }
      ]
    }
  }
}
@enduml
```

---

## 5. Eventos de Socket en Tiempo Real (Servidor → Cliente)

### Evento votes_updated

```plantuml
@startuml json
{
  "type": "votes_updated",
  "eventId": "6660b1fa24a10f0a8b3d9abc",
  "songId": "6660b3bc24a10f0a8b3d9ac0",
  "totalVotes": 19,
  "timestamp": "2025-06-20T21:35:22Z"
}
@enduml
```

### Evento song_suggested

```plantuml
@startuml json
{
  "type": "song_suggested",
  "eventId": "6660b1fa24a10f0a8b3d9abc",
  "song": {
    "id": "6660b3bc24a10f0a8b3d9ac5",
    "title": "Billie Jean",
    "artist": "Michael Jackson",
    "suggestedBy": "Ana García"
  },
  "timestamp": "2025-06-20T21:10:00Z"
}
@enduml
```

### Evento queue_updated

```plantuml
@startuml json
{
  "type": "queue_updated",
  "eventId": "6660b1fa24a10f0a8b3d9abc",
  "queue": [
    {
      "id": "6660b3bc24a10f0a8b3d9ac0",
      "title": "Billie Jean",
      "artist": "Michael Jackson",
      "votes": 19,
      "status": "APPROVED",
      "position": 1
    },
    {
      "id": "6660b3bc24a10f0a8b3d9ac1",
      "title": "Thriller",
      "artist": "Michael Jackson",
      "votes": 15,
      "status": "APPROVED",
      "position": 2
    }
  ],
  "timestamp": "2025-06-20T21:35:22Z"
}
@enduml
```

### Evento participant_joined

```plantuml
@startuml json
{
  "type": "participant_joined",
  "eventId": "6660b1fa24a10f0a8b3d9abc",
  "participant": {
    "id": "665f9c218f96e2f9451e7140",
    "name": "Ana García"
  },
  "totalParticipants": 43,
  "timestamp": "2025-06-20T21:35:22Z"
}
@enduml
```

### Evento participant_left

```plantuml
@startuml json
{
  "type": "participant_left",
  "eventId": "6660b1fa24a10f0a8b3d9abc",
  "participant": {
    "id": "665f9c218f96e2f9451e7140",
    "name": "Ana García"
  },
  "totalParticipants": 42,
  "timestamp": "2025-06-20T21:40:00Z"
}
@enduml
```

### Evento song_status_changed

```plantuml
@startuml json
{
  "type": "song_status_changed",
  "eventId": "6660b1fa24a10f0a8b3d9abc",
  "song": {
    "id": "6660b3bc24a10f0a8b3d9ac0",
    "title": "Billie Jean",
    "artist": "Michael Jackson",
    "status": "PLAYING"
  },
  "timestamp": "2025-06-20T21:45:00Z"
}
@enduml
```

### Evento event_closed

```plantuml
@startuml json
{
  "type": "event_closed",
  "eventId": "6660b1fa24a10f0a8b3d9abc",
  "finalStats": {
    "totalParticipants": 42,
    "totalSuggestions": 20,
    "totalVotes": 156,
    "averageVotesPerSong": 7.8,
    "topSong": {
      "id": "6660b3bc24a10f0a8b3d9ac0",
      "title": "Billie Jean",
      "artist": "Michael Jackson",
      "votes": 18
    },
    "duration": "3:45:00"
  },
  "timestamp": "2025-06-20T23:45:30Z"
}
@enduml
```

---

## 6. Eventos de Socket en Tiempo Real (Cliente → Servidor)

### Evento join_event

```plantuml
@startuml json
{
  "type": "join_event",
  "eventCode": "ABCD12",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
@enduml
```

### Evento leave_event

```plantuml
@startuml json
{
  "type": "leave_event",
  "eventId": "6660b1fa24a10f0a8b3d9abc"
}
@enduml
```

---

## 7. Esquemas de Documentos de Base de Datos (MongoDB)

### Documento de Usuario

```plantuml
@startuml json
{
  "_id": {"$oid": "665f9b4b8f96e2f9451e713d"},
  "email": "dj@example.com",
  "password": "$2b$10$abcdefghijklmnopqrstuvwx",
  "name": "Juan DJ",
  "role": "DJ",
  "createdAt": {"$date": "2025-06-15T10:00:00Z"},
  "updatedAt": {"$date": "2025-06-20T12:00:00Z"}
}
@enduml
```

### Documento de Evento

```plantuml
@startuml json
{
  "_id": {"$oid": "6660b1fa24a10f0a8b3d9abc"},
  "name": "Fiesta Fin de Exámenes",
  "code": "ABCD12",
  "djId": {"$oid": "665f9b4b8f96e2f9451e713d"},
  "status": "ACTIVE",
  "location": "Bar Central",
  "startTime": {"$date": "2025-06-20T22:00:00Z"},
  "endTime": null,
  "settings": {
    "votingEnabled": true,
    "maxSuggestionsPerUser": 3,
    "allowAnonymous": false
  },
  "createdAt": {"$date": "2025-06-20T12:00:00Z"},
  "updatedAt": {"$date": "2025-06-20T21:00:00Z"}
}
@enduml
```

### Documento de Canción

```plantuml
@startuml json
{
  "_id": {"$oid": "6660b3bc24a10f0a8b3d9ac0"},
  "eventId": {"$oid": "6660b1fa24a10f0a8b3d9abc"},
  "title": "Billie Jean",
  "artist": "Michael Jackson",
  "status": "APPROVED",
  "suggestedBy": {"$oid": "665f9c218f96e2f9451e7140"},
  "approvedAt": {"$date": "2025-06-20T20:10:00Z"},
  "position": 1,
  "createdAt": {"$date": "2025-06-20T20:00:00Z"},
  "updatedAt": {"$date": "2025-06-20T21:35:22Z"}
}
@enduml
```

### Documento de Voto

```plantuml
@startuml json
{
  "_id": {"$oid": "6660b5d424a10f0a8b3d9abc"},
  "eventId": {"$oid": "6660b1fa24a10f0a8b3d9abc"},
  "songId": {"$oid": "6660b3bc24a10f0a8b3d9ac0"},
  "userId": {"$oid": "665f9c218f96e2f9451e7140"},
  "value": 1,
  "createdAt": {"$date": "2025-06-20T21:35:22Z"},
  "updatedAt": {"$date": "2025-06-20T21:35:22Z"}
}
@enduml
```

### Documento de Participante

```plantuml
@startuml json
{
  "_id": {"$oid": "6660b6e524a10f0a8b3d9abc"},
  "eventId": {"$oid": "6660b1fa24a10f0a8b3d9abc"},
  "userId": {"$oid": "665f9c218f96e2f9451e7140"},
  "joinedAt": {"$date": "2025-06-20T21:30:00Z"},
  "leftAt": null,
  "active": true
}
@enduml
```

---

## 8. Respuestas de Error Estándar

### Formato de Error Genérico

```plantuml
@startuml json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Mensaje de error legible para humanos",
    "details": "Detalles adicionales opcionales"
  },
  "statusCode": 400
}
@enduml
```

### Error de Validación

```plantuml
@startuml json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "La validación falló",
    "fields": {
      "email": "Formato de email inválido",
      "password": "La contraseña debe tener al menos 8 caracteres"
    }
  },
  "statusCode": 400
}
@enduml
```

### Error No Autorizado

```plantuml
@startuml json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Token inválido o expirado"
  },
  "statusCode": 401
}
@enduml
```

### Error Prohibido

```plantuml
@startuml json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "No tiene permiso para realizar esta acción"
  },
  "statusCode": 403
}
@enduml
```

### Error del Servidor

```plantuml
@startuml json
{
  "success": false,
  "error": {
    "code": "INTERNAL_SERVER_ERROR",
    "message": "Ha ocurrido un error inesperado"
  },
  "statusCode": 500
}
@enduml
```

---

## Flujo de Datos Backend

### Flujo de Solicitud → Respuesta
```
Entrada del Usuario
    ↓
Solicitud HTTP/Socket
    ↓
Controller valida
    ↓
Service ejecuta lógica
    ↓
Repository accede a BD
    ↓
BD devuelve datos
    ↓
Service procesa respuesta
    ↓
Socket emite si es necesario
    ↓
Respuesta HTTP/Socket al cliente
```

### Cambios de Estado de Base de Datos
```
Usuario vota sobre canción
    ↓
INSERT documento de voto
    ↓
Agregar votos para canción
    ↓
Emitir evento votes_updated
    ↓
Frontend actualiza UI
```

### Propagación en Tiempo Real
```
Backend emite evento de socket
    ↓
Todos los clientes conectados reciben
    ↓
Clientes actualizan estado
    ↓
UI se redibuja
```

---

## Patrones Clave de JSON Backend

Estructura de Respuesta Consistente - Todas las respuestas tienen `success`, `data`, `message`
Estandarización de Errores - Todos los errores tienen `code` y `message`
Seguridad de Tipo - Usar validación de mongoose para esquemas
Eventos en Tiempo Real - Incluir `type` y `timestamp` en todos los eventos de socket
Manejo de Relaciones - Las claves externas se almacenan como referencias ObjectId

---

Este documento cubre **JSON producido y consumido por Backend**. Para JSON consumido por la UI Frontend, consulte `syncrekuest-frontend/docs-frontend/json-frontend_ES.md`.
