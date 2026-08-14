const textEncoder = new TextEncoder();

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function randomValue(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export function createLineOAuthRequest(redirectUri: string) {
  const state = randomValue();
  const verifier = randomValue(48);

  return {
    state,
    verifier,
    authorizationUrl: new URL("https://access.line.me/oauth2/v2.1/authorize"),
  };
}

export async function createPkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export async function linePassword(lineUserId: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(lineUserId));
  return `${base64Url(new Uint8Array(signature))}aA!1`;
}

export function lineUserEmail(lineUserId: string) {
  return `line-${lineUserId.toLowerCase()}@line.local`;
}
