### Documento: Propuesta de Aplicación para la Participación Colectiva en la Selección de Música

#### Problema

Un problema común a la hora de disfrutar de la música en muchos clubes y eventos de ocio nocturno es la imposibilidad del público de decidir colectivamente su propia música. Esta limitación afecta la interacción entre el DJ y la audiencia, reduciendo el nivel de participación y dinamismo en el evento.

#### Solución

La aplicación propuesta tiene como objetivo resolver esta problemática, proporcionando a los asistentes opciones para interactuar activamente con la música, mejorando la comunicación y sinergia entre el DJ y la audiencia.

La aplicación será una plataforma web/móvil que permite al público participar en la selección de la música. Conectándose al perfil del DJ, habilita un sistema de votación en tiempo real. Los asistentes podrán sugerir canciones o elegir entre playlists, generando un set más dinámico y participativo.

#### Justificación de la Viabilidad y Relevancia

* **Viabilidad técnica**: La implementación se basará en un sistema de colas y votación similar a las plataformas de streaming, integrándose con software DJ habitual (Serato, Rekordbox, Traktor) mediante APIs o plugins.

* **Viabilidad social**: La música es un elemento central en la vida nocturna. Dar voz al público crea una experiencia más inmersiva y democrática, potenciando la participación activa.

* **Viabilidad profesional**: La herramienta no elimina el rol creativo del DJ, sino que lo complementa. Les ofrece métricas sobre los gustos del público, fortaleciendo su conexión con la audiencia a lo largo del evento.

En el mercado ya existen aplicaciones de jukebox digital o listas de reproducción colaborativas, pero estas están centradas principalmente en bares o uso doméstico. Esta propuesta se distingue por su integración en entornos profesionales de clubbing, garantizando la calidad del set y respetando la identidad del DJ.

#### Identificación del Público Objetivo

El público objetivo se divide en dos grupos:

* **Principal - Attendee**: Jóvenes adultos (18–35 años) que asisten a clubes, festivales y fiestas privadas, y tienen el hábito de interactuar digitalmente en eventos (redes sociales, apps de entrada, etc.).

* **Secundario - DJ**: DJs y organizadores de eventos que buscan innovar la experiencia de sus asistentes.

#### Posibles Tecnologías a Explorar

* **Frontend**: React o Vue para desarrollar una aplicación web/móvil en formato PWA (Progressive Web Application).
* **Backend**: Node.js con WebSockets para facilitar la interacción en tiempo real entre usuarios y el DJ.
* **Base de Datos**: MongoDB o Firebase para gestionar usuarios, votos y canciones sugeridas.
* **Integración Musical**: Uso de APIs como Spotify o Apple Music para previsualizar y sugerir canciones, además de plugins compatibles con el software de DJ profesional.

* **Inteligencia Artificial como Filtro de Calidad**: Análisis en tiempo real de las sugerencias para garantizar que sean compatibles con el género, tempo y estilo del set activo, sin limitar la participación del público.

* **Extras Futuros**: Incorporación de un sistema de moderación para prevenir abusos, así como funciones de gamificación que reconozcan a los participantes más activos.

---

### Análisis de la Base de Datos

A continuación, se analiza cómo la estructura de la base de datos que te proporcioné (basada en un modelo SQL) cumple con los requerimientos de la propuesta:

#### Requisitos de la Aplicación vs Esquema de Base de Datos

1. **Gestión de Usuarios**

   * El sistema debe permitir a los usuarios crear cuentas, tener perfiles y roles (asistentes, DJs, administradores). Esto está cubierto en la tabla `Users`, donde cada usuario tiene un `role` definido (que puede ser `ATTENDEE`, `DJ`, o `ADMIN`), y el sistema gestiona su actividad mediante los campos `isActive`, `lastLoginAt`, `createdAt`, y `updatedAt`.

2. **Gestión de Eventos**

   * La tabla `Events` gestiona la información de los eventos, incluyendo el `ownerId` (referencia al DJ), el `accessCode` para acceder al evento, y los estados del evento (DRAFT, LIVE, ENDED, CANCELLED). También se maneja la fecha y hora de inicio (`startsAt`) y finalización (`endedAt`), junto con los detalles del evento, como la descripción y el QR code.

3. **Participación en la Música**

   * La tabla `Participants` registra a los usuarios que asisten a un evento. Almacenamos la información de su `nickname`, su estado (como si están baneados o expulsados), y el histórico de sus interacciones en el evento (como la hora en que se unieron, y la última vez que fueron vistos).

4. **Sistema de Votación de Canciones**

   * La funcionalidad de votación está cubierta por la tabla `Votes`, donde se registra cada voto realizado por un `participantId` en un `songId`. El valor del voto puede ser `-1` o `1`, lo que permite a los asistentes influir en la selección de las canciones.

5. **Gestión de Canciones**

   * Las canciones son gestionadas a través de la tabla `Songs`, donde se almacenan el `title`, `artist`, el `requestedBy` (quien solicitó la canción), el `status` de la canción (pendiente, aprobada, etc.), y otras propiedades como `voteScore` y `pinned`.

6. **Acciones del Evento (Acciones del DJ)**

   * Los logs de las acciones realizadas durante el evento (como el inicio, la finalización, o cambios en las canciones) se gestionan en la tabla `EventActionLogs`. Esto permite registrar eventos como la aprobación de una canción o la expulsión de un participante, lo cual es esencial para los DJs y administradores.

7. **Sugerencias y Filtrado de Canciones**

   * El sistema de filtrado de calidad de las sugerencias puede estar soportado por un proceso de backend utilizando inteligencia artificial o algoritmos de validación basados en los datos de las canciones y la interacción de los participantes. Aunque no está explicitado en la base de datos, los campos `status`, `voteScore`, y `voteCount` de la tabla `Songs` son indicadores de la calidad de las canciones y su aceptación.

#### Conclusión

El esquema de base de datos en SQL propuesto cumple con los requisitos de la aplicación descrita en el documento. La base de datos gestiona adecuadamente los usuarios, eventos, participantes, canciones y votaciones, permitiendo una experiencia interactiva para los usuarios y DJs. Además, la implementación de la tabla `EventActionLogs` y el uso de `JSON` para permisos y metadatos proporcionan la flexibilidad necesaria para adaptarse a futuros desarrollos como el sistema de moderación y la gamificación.