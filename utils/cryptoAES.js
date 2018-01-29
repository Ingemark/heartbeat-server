var CryptoJS = require("crypto-js");

function encrypt(json, key) {
  return CryptoJS.AES.encrypt(JSON.stringify(json), key).toString();
}

function decryptToJSON(cipher, key) {
  var data = CryptoJS.AES.decrypt(cipher, key);
  return JSON.parse(data.toString(CryptoJS.enc.Utf8));
}

module.exports = {
  encrypt: encrypt,
  decryptToJSON: decryptToJSON
}
