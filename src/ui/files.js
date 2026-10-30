// Local file helpers. Downloads are generated in the browser (blob URLs);
// nothing is sent anywhere.

export function downloadBytes(name, bytes, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(name, text, type = 'text/plain') {
  downloadBytes(name, new TextEncoder().encode(text), `${type};charset=utf-8`);
}

/** Opens a file picker and resolves with the chosen file's text (or null). */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', async () => resolve(input.files[0] ? await input.files[0].text() : null));
    input.click();
  });
}
