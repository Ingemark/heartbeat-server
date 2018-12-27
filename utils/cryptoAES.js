var CryptoJS = require("crypto-js");

let keySize = 256; // bits
let ivSize = 128; // bits
let saltSize = 128; // bits
let iterations = 3;

function encrypt(json, pass) {
  let salt = CryptoJS.lib.WordArray.random(saltSize/8);
  let iv = CryptoJS.lib.WordArray.random(ivSize/8);

  let key = CryptoJS.PBKDF2(pass, salt, {
    keySize: keySize/32, // words
    iterations: iterations,
    hasher: CryptoJS.algo.SHA1
  });

  let encrypted = CryptoJS.AES.encrypt(JSON.stringify(json), key, {
    iv: iv,
    padding: CryptoJS.pad.Pkcs7,
    mode: CryptoJS.mode.CBC
  });

  let transitMessage = salt.toString() + iv.toString() + encrypted.toString();

  return transitMessage;
}

function decryptToJSON (transitMessage, pass) {
  let salt = CryptoJS.enc.Hex.parse(transitMessage.substr(0, 32));
  let iv = CryptoJS.enc.Hex.parse(transitMessage.substr(32, 32));
  let encrypted = transitMessage.substring(64);

  let key = CryptoJS.PBKDF2(pass, salt, {
    keySize: keySize/32,
    iterations: iterations,
    hasher: CryptoJS.algo.SHA1
  });

  let decrypted = CryptoJS.AES.decrypt(encrypted, key, {
    iv: iv,
    padding: CryptoJS.pad.Pkcs7,
    mode: CryptoJS.mode.CBC
  });
  
  return JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
}

module.exports = {
  encrypt: encrypt,
  decryptToJSON: decryptToJSON
};
