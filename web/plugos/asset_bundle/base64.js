export function base64Decode(s) {
  const binString = atob(s);
  const len = binString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binString.charCodeAt(i);
  }
  return bytes;
}
export function base64Encode(buffer) {
  let binary = "";
  const len = buffer.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}
export function base64EncodedDataUrl(mimeType, buffer) {
  return `data:${mimeType};base64,${base64Encode(buffer)}`;
}
export function base64DecodeDataUrl(dataUrl) {
  const b64Encoded = dataUrl.split(",", 2)[1];
  return base64Decode(b64Encoded);
}
