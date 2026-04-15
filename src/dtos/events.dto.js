function toCreateEventDTO(body) {
  return {
    name: typeof body.name === 'string' ? body.name.trim() : body.name,
    description:
      typeof body.description === 'string'
        ? body.description.trim()
        : body.description || '',
    startsAt: body.startsAt,
  };
}

function toUpdateEventDTO(body) {
  const dto = {};
  if (body.name !== undefined)
    dto.name = typeof body.name === 'string' ? body.name.trim() : body.name;
  if (body.description !== undefined)
    dto.description =
      typeof body.description === 'string'
        ? body.description.trim()
        : body.description;
  if (body.settings !== undefined) dto.settings = body.settings;
  return dto;
}

module.exports = { toCreateEventDTO, toUpdateEventDTO };
