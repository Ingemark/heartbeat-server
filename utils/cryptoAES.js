var CryptoJS = require("crypto-js");

function encrypt(json, key) {
  return CryptoJS.AES.encrypt(JSON.stringify(json), key).toString();
}

function decryptToJSON(cipher, key) {
  let data = CryptoJS.AES.decrypt(cipher, key);
  try {
    return JSON.parse(data.toString(CryptoJS.enc.Utf8));
  } catch {
    throw new Error("Unable to decrypt heartbeat token.");
  }
}

module.exports = {
  encrypt: encrypt,
  decryptToJSON: decryptToJSON
};
