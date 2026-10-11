/**
 * Pulls plain text out of an uploaded agreement.
 *
 * Freelancers get briefs as .docx from clients, .pdf from lawyers, and
 * .md/.txt from other freelancers. All three land here.
 */

const MAX_BYTES = 8 * 1024 * 1024;

export async function extractText(buffer, filename = '', mimetype = '') {
  if (!buffer?.length) throw badRequest('That file is empty.');
  if (buffer.length > MAX_BYTES) throw badRequest('That file is larger than 8 MB.');

  const ext = (filename.split('.').pop() || '').toLowerCase();

  if (ext === 'docx' || mimetype.includes('wordprocessingml')) {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.extractRawText({ buffer });
    return tidy(value);
  }

  if (ext === 'pdf' || mimetype === 'application/pdf') {
    const { default: pdfParse } = await import('pdf-parse');
    const { text } = await pdfParse(buffer);
    return tidy(text);
  }

  if (['txt', 'md', 'markdown', 'rtf', ''].includes(ext) || mimetype.startsWith('text/')) {
    return tidy(buffer.toString('utf8'));
  }

  throw badRequest(`Cannot read .${ext} files. Use .docx, .pdf, .txt or .md.`);
}

function tidy(text) {
  const out = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!out) throw badRequest('No readable text in that file. If it is a scan, paste the text instead.');
  return out;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}
