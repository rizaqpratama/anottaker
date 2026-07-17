// crypto.randomUUID() is available under Node and Chromium (desktop) but not under
// Hermes (React Native) without a polyfill. Mobile entry points should call
// setIdGenerator() with an expo-crypto/uuid-backed implementation at startup.
let generator: () => string = () => crypto.randomUUID()

export function setIdGenerator(fn: () => string) {
  generator = fn
}

export function uid() {
  return generator()
}
