const { ValidationError } = require('../errors');

const MAX_MULTIPART_BYTES = 65 * 1024 * 1024;

function parseMultipartAudio(req, res, next) {
  const contentType = req.headers['content-type'] || '';
  const boundary = contentType.match(/boundary=([^;]+)/i)?.[1];
  if (!boundary) return next(new ValidationError('multipart/form-data boundary is required'));

  const chunks = [];
  let size = 0;

  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_MULTIPART_BYTES) {
      req.destroy(new ValidationError('Upload is too large'));
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    try {
      const { fields, file } = parseMultipart(Buffer.concat(chunks), boundary);
      req.body = fields;
      req.file = file;
      next();
    } catch (error) {
      next(error);
    }
  });
  req.on('error', next);
}

function parseMultipart(buffer, boundary) {
  const marker = Buffer.from(`--${boundary}`);
  const fields = {};
  let file = null;
  let offset = 0;

  while ((offset = buffer.indexOf(marker, offset)) !== -1) {
    offset += marker.length;
    if (buffer[offset] === 45 && buffer[offset + 1] === 45) break;
    if (buffer[offset] === 13 && buffer[offset + 1] === 10) offset += 2;

    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), offset);
    if (headerEnd === -1) break;
    const headers = buffer.toString('utf8', offset, headerEnd);
    let dataStart = headerEnd + 4;
    let dataEnd = buffer.indexOf(Buffer.from(`\r\n--${boundary}`), dataStart);
    if (dataEnd === -1) dataEnd = buffer.length;

    const name = headers.match(/name="([^"]+)"/)?.[1];
    const filename = headers.match(/filename="([^"]*)"/)?.[1];
    const contentType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || '';
    const data = buffer.subarray(dataStart, dataEnd);

    if (filename) {
      file = { fieldname: name, filename, contentType, buffer: data };
    } else if (name) {
      fields[name] = data.toString('utf8');
    }
    offset = dataEnd;
  }

  return { fields, file };
}

module.exports = { parseMultipartAudio };
