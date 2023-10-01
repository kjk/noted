import {
  decrypt,
  encrypt,
  generateEncryptionKey,
  generateSalt,
  hashPassword,
} from "kiss-crypto";

// https://github.com/team-reflect/kiss-crypto

// const key = await generateEncryptionKey();

const password = "password1";
const salt = await generateSalt();
const key = await hashPassword({ password, salt });

const plaintext = "hello world";

const ciphertext = await encrypt({
  plaintext,
  key,
});

const decrypted = await decrypt({
  ciphertext,
  key,
});
